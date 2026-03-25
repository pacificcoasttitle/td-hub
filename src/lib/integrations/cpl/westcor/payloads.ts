import type { CplOrderDetail, CplGenerateInput, CplForm, TransactionType } from '../types';

const TIMEOUT_MS = 15_000;
const CPL_TIMEOUT_MS = 30_000;

// ─── Branch info needed by the payload builders ─────────────────────────────

export interface WestcorBranchInfo {
  branchCode: string;
  agencyName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

// ─── Westcor response shape (from Order/Update Step A) ──────────────────────

export interface WestcorOrderResponse {
  tvid?: number;
  agentnumber?: string;
  buyers?: Array<{ NameID?: number }>;
  sellers?: Array<{ NameID?: number }>;
  lenders?: Array<{ Id?: number }>;
  property?: Array<{ PropertyID?: number }>;
  messages?: { success?: string[]; warning?: string[]; error?: string[] };
}

// ─── PrepareAddCPL result ───────────────────────────────────────────────────

export interface PrepareAddCplResult {
  forms: CplForm[];
  cplTemplate: Record<string, unknown>;
}

// ─── Preflight validation ───────────────────────────────────────────────────

export interface PreflightContext {
  orderDetail: CplOrderDetail;
  input: CplGenerateInput;
  westcorLenderId: number;
}

export function preflightValidate(ctx: PreflightContext): string[] {
  const errors: string[] = [];
  const { orderDetail, westcorLenderId } = ctx;
  const txType = orderDetail.transactionType;

  if (!orderDetail.property?.address) {
    errors.push('Property address is required.');
  }
  if (orderDetail.buyers.length === 0) {
    errors.push('At least one buyer/borrower is required.');
  }
  if (!orderDetail.lender?.name) {
    errors.push('Lender company name is required to generate a CPL.');
  }

  if (txType === 'Purchase') {
    if (orderDetail.sellers.length === 0) {
      errors.push('Purchase transactions require at least one seller.');
    }
    const price = resolvePurchasePrice(orderDetail, ctx.input);
    if (price <= 0) {
      errors.push('Purchase transactions require a sales amount greater than zero.');
    }
  }

  if (txType === 'Refinance') {
    if (westcorLenderId === 0) {
      errors.push('Refinance transactions require a valid Westcor lender ID. Lender may not have been registered in Westcor.');
    }
  }

  return errors;
}

// ─── Amount resolution (transaction-aware) ──────────────────────────────────

function parseAmount(val: string | null | undefined): number {
  if (!val) return 0;
  return parseInt(String(val).replace(/[^0-9\-]/g, ''), 10) || 0;
}

/**
 * Westcor always expects a `purchase_price` field.
 * - Purchase: use salesPrice (or modal salesAmountOverride)
 * - Refinance: use loanAmount (or modal loanAmountOverride), fall back to salesPrice
 * - Other/Equity/unknown: use whichever is nonzero, prefer salesPrice
 */
export function resolvePurchasePrice(
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
): number {
  const salesOverride = parseAmount(input.salesAmountOverride);
  const loanOverride = parseAmount(input.loanAmountOverride);
  const dbSales = parseAmount(orderDetail.salesPrice);
  const dbLoan = parseAmount(orderDetail.loanAmount);
  const txType = orderDetail.transactionType;

  if (txType === 'Purchase') {
    return salesOverride || dbSales || loanOverride || dbLoan || 0;
  }
  if (txType === 'Refinance') {
    return loanOverride || dbLoan || salesOverride || dbSales || 0;
  }
  // Equity, Other, or null — use whichever is nonzero
  return salesOverride || dbSales || loanOverride || dbLoan || 0;
}

// ─── Shared body helpers (legacy-exact field names from Westcor.php) ────────

function buildProperty(prop: CplOrderDetail['property']) {
  const county = (prop?.county ?? '').trim();
  const suffixed = county
    ? county.toLowerCase().endsWith('county') ? county : `${county} County`
    : '';

  return [{
    PropertyID: 0,
    tvid: 0,
    CountyName: suffixed,
    ShortLegal: null as string | null,
    StreetAddress: prop?.address ?? '',
    City: prop?.city ?? '',
    State: prop?.state ?? 'CA',
    Zip: prop?.zip ?? '',
    PropertyType: 'R',
  }];
}

function buildBuyers(names: string[]) {
  return names.map((fullName, i) => ({
    NameID: 0,
    Last: '-',
    First: fullName.trim(),
    NameType: 1,
    JoiningPhrase: 'single',
    tvid: 0,
    Sequence: i + 1,
    City: null as string | null,
    State: null as string | null,
    Zip: null as string | null,
    Address: null as string | null,
  }));
}

function buildSellers(names: string[], txType: TransactionType | null) {
  // Refinance transactions typically have no seller; don't send placeholders
  const filtered = txType === 'Refinance'
    ? names.filter((n) => !/^tbd\b/i.test(n.trim()))
    : names;

  return filtered.map((fullName, i) => ({
    NameID: 0,
    Last: '-',
    First: fullName.trim(),
    NameType: 2,
    JoiningPhrase: 'single',
    tvid: 0,
    Sequence: i + 1,
    City: null as string | null,
    State: null as string | null,
    Zip: null as string | null,
    Address: null as string | null,
  }));
}

function buildLenders(
  orderDetail: CplOrderDetail,
  lenderOverrides?: CplGenerateInput['lenderOverrides'],
) {
  const lender = orderDetail.lender;
  if (!lender) return [];

  return [{
    Id: 0,
    tvid: 0,
    name: lenderOverrides?.name ?? lender.name ?? '',
    city: lenderOverrides?.city ?? lender.city ?? '',
    state: lenderOverrides?.state ?? lender.state ?? '',
    zip: lenderOverrides?.zip ?? lender.zip ?? '',
    address: lenderOverrides?.address ?? lender.address ?? '',
    phone: null as string | null,
    email: null as string | null,
    countyFIPS: null as string | null,
    assignment: null as string | null,
    mortgageType: null as string | null,
    amount: 0,
    loan_number: '',
    vendorInternalID: null as number | null,
  }];
}

const ACTIONS_CREATE = {
  sdn: false,
  update_base: true,
  update_property: true,
  update_lender: true,
  update_buyers: true,
  update_sellers: true,
  update_attorneys: false,
  update_cpls: false,
  update_jacket: false,
  update_search: false,
  update_reinsurance: false,
  update_priors: false,
};

// ─── Step A: Create order in Westcor ────────────────────────────────────────

export async function createOrUpdateOrder(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
  branch: WestcorBranchInfo,
  existingTvid?: string | null,
): Promise<{ westcorOrderId: string; orderResponse: WestcorOrderResponse }> {
  const body = {
    tvid: existingTvid ? parseInt(existingTvid, 10) || 0 : 0,
    agentnumber: branch.branchCode,
    agent_file_number: orderDetail.fileNumber,
    email_requestor: 'cpl@pct.com',
    purchase_price: resolvePurchasePrice(orderDetail, input),
    property: buildProperty(orderDetail.property),
    buyers: buildBuyers(orderDetail.buyers),
    sellers: buildSellers(orderDetail.sellers, orderDetail.transactionType),
    lenders: buildLenders(orderDetail, input.lenderOverrides),
    search: null,
    commitment: null,
    jacket: null,
    sdn: null,
    history: null,
    notes: null as string | null,
    messages: { success: [] as string[], warning: [] as string[], error: [] as string[] },
    actions: ACTIONS_CREATE,
    partnerCode: parseInt(cfg.integrationPartner, 10) || 0,
    cpl: null,
    priors: null,
  };

  const res = await fetch(
    `${cfg.baseUrl}VendorApi/Order/Update/${cfg.integrationPartner}`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Westcor order update failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as WestcorOrderResponse;

  if (data.messages?.error && data.messages.error.length > 0) {
    throw new Error(data.messages.error[0]);
  }

  const westcorOrderId = String(data.tvid ?? 0);
  return { westcorOrderId, orderResponse: data };
}

// ─── Step B: GET full order from Westcor ─────────────────────────────────────

export async function getOrder(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  westcorOrderId: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${cfg.baseUrl}VendorApi/Order/${westcorOrderId}/${cfg.integrationPartner}`,
    { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`Westcor getOrder failed: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

// ─── Step C: PrepareAddCPL ──────────────────────────────────────────────────

export async function prepareAddCpl(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  westcorOrderId: string,
): Promise<PrepareAddCplResult> {
  const url =
    `${cfg.baseUrl}VendorApi/ClosingLetters/PrepareAddCPL/${westcorOrderId}/${cfg.integrationPartner}`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Westcor PrepareAddCPL failed: HTTP ${res.status}`);
  }

  const text = await res.text();
  if (!text) return { forms: [], cplTemplate: {} };

  const data = JSON.parse(text) as Record<string, unknown>;

  const cplObj = (data.CPL ?? data) as Record<string, unknown>;
  const rawForms = (cplObj.Forms ?? []) as Array<Record<string, unknown>>;

  const forms: CplForm[] = rawForms.map((f) => ({
    id: String(f.FormId ?? f.FormName ?? ''),
    name: String(f.FormName ?? f.name ?? ''),
  }));

  return { forms, cplTemplate: cplObj };
}

// ─── Whitelisted CPL entry builder ──────────────────────────────────────────
// Instead of `...cplTemplate` which sends read-only/internal Westcor fields
// back (causing NullReferenceException), only include explicitly required fields.

const CPL_TEMPLATE_SAFE_KEYS = new Set([
  'TVID', 'CPLID', 'LetterName', 'LenderID',
  'PolicyProducingAgentAddressID', 'PolicyProducingAgentAddress',
  'PolicyProducingAgentCity', 'PolicyProducingAgentState', 'PolicyProducingAgentZip',
  'PolicyProducingAgentNumber',
  'ProtectLender', 'ClosingAgentNumber', 'IsDualCPL',
  'FileInformation', 'EffectiveDate', 'ExpirationDate',
  'ProtectBuyer', 'ProtectSeller', 'ProtectBorrower',
]);

function buildCplEntry(
  cplTemplate: Record<string, unknown>,
  selectedFormName: string,
  westcorLenderId: number,
  branch: WestcorBranchInfo,
  westcorOrderTvid: string | number,
): Record<string, unknown> {
  // Start with only safe fields from the template
  const safeBase: Record<string, unknown> = {};
  for (const key of CPL_TEMPLATE_SAFE_KEYS) {
    if (key in cplTemplate && cplTemplate[key] !== undefined) {
      safeBase[key] = cplTemplate[key];
    }
  }

  // Override with our required values
  return {
    ...safeBase,
    TVID: safeBase.TVID ?? (Number(westcorOrderTvid) || 0),
    CPLID: -1,
    LetterName: selectedFormName,
    FileInformation: null,
    LenderID: westcorLenderId,
    PolicyProducingAgentAddressID: branch.branchCode,
    PolicyProducingAgentNumber: branch.branchCode,
    PolicyProducingAgentAddress: branch.address,
    PolicyProducingAgentCity: branch.city,
    PolicyProducingAgentState: branch.state,
    PolicyProducingAgentZip: branch.zip,
    ProtectLender: true,
    ClosingAgentNumber: branch.branchCode,
    IsDualCPL: false,
  };
}

// ─── Step D: Generate CPL PDF ───────────────────────────────────────────────

export async function generateCplPdf(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  westcorOrder: Record<string, unknown>,
  cplTemplate: Record<string, unknown>,
  selectedFormName: string,
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
  branch: WestcorBranchInfo,
  orderResponse: WestcorOrderResponse,
): Promise<{ pdf: string; cplId: string; diagnostics: Record<string, unknown> }> {
  const buyers = buildBuyers(orderDetail.buyers);
  const sellers = buildSellers(orderDetail.sellers, orderDetail.transactionType);
  const lenders = buildLenders(orderDetail, input.lenderOverrides);

  // Extract IDs from Step A response, falling back to Step B GET response
  const getOrderBuyers = (westcorOrder.buyers ?? []) as Array<Record<string, unknown>>;
  const getOrderSellers = (westcorOrder.sellers ?? []) as Array<Record<string, unknown>>;
  const getOrderLenders = (westcorOrder.lenders ?? []) as Array<Record<string, unknown>>;

  const resBuyers = orderResponse.buyers ?? [];
  for (let i = 0; i < buyers.length; i++) {
    buyers[i].NameID = resBuyers[i]?.NameID
      ?? (getOrderBuyers[i]?.NameID as number)
      ?? 0;
  }
  const resSellers = orderResponse.sellers ?? [];
  for (let i = 0; i < sellers.length; i++) {
    sellers[i].NameID = resSellers[i]?.NameID
      ?? (getOrderSellers[i]?.NameID as number)
      ?? 0;
  }
  const westcorLenderId = orderResponse.lenders?.[0]?.Id
    ?? (getOrderLenders[0]?.Id as number)
    ?? 0;
  if (lenders[0]) {
    lenders[0].Id = westcorLenderId;
  }

  const westcorOrderTvid = westcorOrder.tvid ?? orderResponse.tvid ?? 0;

  const cplEntry = buildCplEntry(
    cplTemplate, selectedFormName, westcorLenderId, branch, westcorOrderTvid as string | number,
  );

  // Build Step D body from scratch — NEVER spread westcorOrder.
  // Legacy PHP builds Step D identically to Step A, only adding
  // the CPL entry and setting update_cpls: true.
  const body = {
    tvid: Number(westcorOrderTvid) || 0,
    agentnumber: branch.branchCode,
    agent_file_number: orderDetail.fileNumber,
    email_requestor: 'cpl@pct.com',
    purchase_price: resolvePurchasePrice(orderDetail, input),
    property: buildProperty(orderDetail.property),
    buyers,
    sellers,
    lenders,
    cpl: [cplEntry],
    search: null,
    commitment: null,
    jacket: null,
    sdn: null,
    history: null,
    notes: null as string | null,
    messages: { success: [] as string[], warning: [] as string[], error: [] as string[] },
    actions: {
      sdn: false,
      update_base: true,
      update_property: true,
      update_lender: true,
      update_buyers: true,
      update_sellers: true,
      update_attorneys: false,
      update_cpls: true,
      update_jacket: false,
      update_search: false,
      update_reinsurance: false,
      update_priors: false,
    },
    partnerCode: parseInt(cfg.integrationPartner, 10) || 0,
    priors: null,
  };

  // Capture payload diagnostics for logging
  const diagnostics: Record<string, unknown> = {
    payloadTopKeys: Object.keys(body),
    tvid: body.tvid,
    cplEntryKeys: Object.keys(cplEntry),
    cplEntry,
    buyerCount: buyers.length,
    buyerIds: buyers.map((b) => b.NameID),
    sellerCount: sellers.length,
    sellerIds: sellers.map((s) => s.NameID),
    lenderCount: lenders.length,
    lenderId: lenders[0]?.Id ?? null,
    lenderTvid: lenders[0]?.tvid ?? null,
    propertyId: body.property[0]?.PropertyID ?? null,
    purchasePrice: body.purchase_price,
  };

  const res = await fetch(
    `${cfg.baseUrl}VendorApi/Order/Update/${cfg.integrationPartner}`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CPL_TIMEOUT_MS),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    diagnostics.httpStatus = res.status;
    diagnostics.rawResponse = text.slice(0, 500);
    throw Object.assign(
      new Error(`Westcor CPL generation failed: HTTP ${res.status} — ${text.slice(0, 300)}`),
      { diagnostics },
    );
  }

  const rawText = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText);
  } catch {
    diagnostics.rawResponse = rawText.slice(0, 500);
    throw Object.assign(
      new Error('Westcor CPL response was not valid JSON'),
      { diagnostics },
    );
  }

  // Capture full response shape for debugging
  diagnostics.responseTopKeys = Object.keys(data);
  diagnostics.responseMessages = data.messages ?? null;
  diagnostics.responseCplCount = Array.isArray(data.cpl) ? (data.cpl as unknown[]).length : 0;

  const messages = data.messages as { error?: string[]; warning?: string[]; success?: string[] } | undefined;

  if (messages?.error && messages.error.length > 0) {
    diagnostics.westcorErrors = messages.error;
    diagnostics.westcorWarnings = messages.warning ?? [];
    throw Object.assign(
      new Error(`Westcor CPL error: ${messages.error.join('; ')}`),
      { diagnostics },
    );
  }

  const cplEntries = (data.cpl ?? []) as Array<{
    CPLID?: number;
    cplNumber?: string;
    FileInformation?: { FileAsBase64?: string; FileAsDataVaultFileID?: string };
  }>;
  const lastCpl = cplEntries[cplEntries.length - 1];
  if (!lastCpl) {
    throw Object.assign(
      new Error('Westcor returned no CPL entry'),
      { diagnostics },
    );
  }

  const pdf = lastCpl.FileInformation?.FileAsBase64 ?? '';
  if (!pdf) {
    diagnostics.cplEntryResponse = lastCpl;
    throw Object.assign(
      new Error('Westcor returned empty CPL PDF'),
      { diagnostics },
    );
  }

  const cplId = String(lastCpl.CPLID ?? lastCpl.cplNumber ?? `WC-${Date.now()}`);
  return { pdf, cplId, diagnostics };
}

// ─── Form selection ─────────────────────────────────────────────────────────

export function selectCplForm(
  forms: CplForm[],
  mode: 'single' | 'multiple' = 'single',
): CplForm {
  if (forms.length === 0) throw new Error('No CPL forms available from Westcor');

  if (mode === 'single') {
    const singleMatch = forms.find(
      (f) => /\bsingle\b/i.test(f.name) && !/multiple|blanket/i.test(f.name),
    );
    if (singleMatch) return singleMatch;
    const nonMultiple = forms.find((f) => !/multiple|blanket/i.test(f.name));
    if (nonMultiple) return nonMultiple;
  } else {
    const multiMatch = forms.find((f) => /multiple|blanket/i.test(f.name));
    if (multiMatch) return multiMatch;
  }

  const available = forms.map((f) => `"${f.name}"`).join(', ');
  throw new Error(
    `No matching CPL form for mode "${mode}". Available forms: ${available}`,
  );
}

// ─── Name parsing (kept for other callers) ──────────────────────────────────

export function parseName(
  fullName: string,
): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (trimmed.includes(',')) {
    const [last, first] = trimmed.split(',', 2);
    return { firstName: (first ?? '').trim(), lastName: (last ?? '').trim() };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  const last = parts.pop()!;
  return { firstName: parts.join(' '), lastName: last };
}
