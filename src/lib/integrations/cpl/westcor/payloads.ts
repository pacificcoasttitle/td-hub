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
  buyers?: Array<{ NameID?: number; tvid?: number | string }>;
  sellers?: Array<{ NameID?: number; tvid?: number | string }>;
  lenders?: Array<{ Id?: number; tvid?: number | string }>;
  property?: Array<{ PropertyID?: number; tvid?: number | string }>;
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

function buildProperty(
  prop: CplOrderDetail['property'],
  ids?: { PropertyID?: number; tvid?: number | string },
) {
  const county = (prop?.county ?? '').trim();
  const suffixed = county
    ? county.toLowerCase().endsWith('county') ? county : `${county} County`
    : '';

  return [{
    PropertyID: ids?.PropertyID ?? 0,
    tvid: Number(ids?.tvid ?? 0) || 0,
    CountyName: suffixed,
    ShortLegal: null as string | null,
    StreetAddress: prop?.address ?? '',
    City: prop?.city ?? '',
    State: prop?.state ?? 'CA',
    Zip: prop?.zip ?? '',
    PropertyType: 'R',
  }];
}

function buildBuyers(
  names: string[],
  ids?: Array<{ NameID?: number; tvid?: number | string }>,
) {
  return names.map((fullName, i) => ({
    NameID: ids?.[i]?.NameID ?? 0,
    Last: '-',
    First: fullName.trim(),
    NameType: 1,
    JoiningPhrase: 'single',
    tvid: Number(ids?.[i]?.tvid ?? 0) || 0,
    Sequence: i + 1,
    City: null as string | null,
    State: null as string | null,
    Zip: null as string | null,
    Address: null as string | null,
  }));
}

function buildSellers(
  names: string[],
  txType: TransactionType | null,
  ids?: Array<{ NameID?: number; tvid?: number | string }>,
) {
  // Refinance transactions typically have no seller; don't send placeholders
  const filtered = txType === 'Refinance'
    ? names.filter((n) => !/^tbd\b/i.test(n.trim()))
    : names;

  return filtered.map((fullName, i) => ({
    NameID: ids?.[i]?.NameID ?? 0,
    Last: '-',
    First: fullName.trim(),
    NameType: 2,
    JoiningPhrase: 'single',
    tvid: Number(ids?.[i]?.tvid ?? 0) || 0,
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
  ids?: { Id?: number; tvid?: number | string },
) {
  const lender = orderDetail.lender;
  if (!lender) return [];

  return [{
    Id: ids?.Id ?? 0,
    tvid: Number(ids?.tvid ?? 0) || 0,
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
    agencyname: branch.agencyName,
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

// ─── CPL entry builder (legacy-exact, zero template inheritance) ─────────
// Previous approaches inherited from cplTemplate (first blind spread, then
// whitelist). Both caused Westcor EF errors. Now: build from scratch using
// ONLY the 13 fields the legacy PHP sends. Nothing from the template.

function buildCplEntry(
  _cplTemplate: Record<string, unknown>,
  selectedFormName: string,
  westcorLenderId: number,
  branch: WestcorBranchInfo,
  westcorOrderTvid: string | number,
): Record<string, unknown> {
  return {
    TVID: Number(westcorOrderTvid) || 0,
    CPLID: -1,
    FileInformation: null,
    LetterName: selectedFormName,
    LenderID: westcorLenderId,
    PolicyProducingAgentNumber: branch.branchCode,
    PolicyProducingAgentAddressID: branch.branchCode,
    PolicyProducingAgentAddress: branch.address,
    PolicyProducingAgentCity: branch.city,
    PolicyProducingAgentState: branch.state,
    PolicyProducingAgentZip: branch.zip,
    ProtectLender: true,
    ClosingAgentNumber: 'CA1038',
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
  // Extract IDs from Step A response, falling back to Step B GET response
  const getOrderBuyers = (westcorOrder.buyers ?? []) as Array<Record<string, unknown>>;
  const getOrderSellers = (westcorOrder.sellers ?? []) as Array<Record<string, unknown>>;
  const getOrderLenders = (westcorOrder.lenders ?? []) as Array<Record<string, unknown>>;
  const getOrderProperty = (westcorOrder.property ?? []) as Array<Record<string, unknown>>;
  const westcorOrderTvid = westcorOrder.tvid ?? orderResponse.tvid ?? 0;

  const propertyId = orderResponse.property?.[0]?.PropertyID
    ?? (getOrderProperty[0]?.PropertyID as number)
    ?? 0;
  const propertyTvid = orderResponse.property?.[0]?.tvid
    ?? (getOrderProperty[0]?.tvid as number | string)
    ?? westcorOrderTvid;

  const buyerIds = orderDetail.buyers.map((_, i) => ({
    NameID: orderResponse.buyers?.[i]?.NameID
      ?? (getOrderBuyers[i]?.NameID as number)
      ?? 0,
    tvid: orderResponse.buyers?.[i]?.tvid
      ?? (getOrderBuyers[i]?.tvid as number | string)
      ?? westcorOrderTvid,
  }));
  const sellerIds = buildSellers(orderDetail.sellers, orderDetail.transactionType).map((_, i) => ({
    NameID: orderResponse.sellers?.[i]?.NameID
      ?? (getOrderSellers[i]?.NameID as number)
      ?? 0,
    tvid: orderResponse.sellers?.[i]?.tvid
      ?? (getOrderSellers[i]?.tvid as number | string)
      ?? westcorOrderTvid,
  }));
  const westcorLenderId = orderResponse.lenders?.[0]?.Id
    ?? (getOrderLenders[0]?.Id as number)
    ?? 0;
  const lenderTvid = orderResponse.lenders?.[0]?.tvid
    ?? (getOrderLenders[0]?.tvid as number | string)
    ?? westcorOrderTvid;

  const property = buildProperty(orderDetail.property, {
    PropertyID: propertyId,
    tvid: propertyTvid,
  });
  const buyers = buildBuyers(orderDetail.buyers, buyerIds);
  const sellers = buildSellers(orderDetail.sellers, orderDetail.transactionType, sellerIds);
  const lenders = buildLenders(orderDetail, input.lenderOverrides, {
    Id: westcorLenderId,
    tvid: lenderTvid,
  });

  const cplEntry = buildCplEntry(
    cplTemplate, selectedFormName, westcorLenderId, branch, westcorOrderTvid as string | number,
  );

  const LEGACY_STEP_D_FIELDS = [
    'tvid', 'agentnumber', 'agencyname', 'agent_file_number', 'email_requestor',
    'purchase_price', 'property', 'buyers', 'sellers', 'lenders',
    'search', 'commitment', 'jacket', 'sdn', 'history', 'notes', 'messages',
    'actions', 'partnerCode', 'cpl', 'priors',
  ] as const;

  // Build the full legacy-shaped Step D payload, but only from our own
  // allowlisted builders with Westcor-assigned IDs preserved.
  const body: Record<string, unknown> = {
    tvid: Number(westcorOrderTvid) || 0,
    agentnumber: branch.branchCode,
    agencyname: branch.agencyName,
    agent_file_number: orderDetail.fileNumber,
    email_requestor: 'cpl@pct.com',
    purchase_price: resolvePurchasePrice(orderDetail, input),
    property,
    buyers,
    sellers,
    lenders,
    search: null,
    commitment: null,
    jacket: null,
    sdn: null,
    history: null,
    notes: null,
    messages: { success: [] as string[], warning: [] as string[], error: [] as string[] },
    partnerCode: parseInt(cfg.integrationPartner, 10) || 0,
    cpl: [cplEntry],
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
    priors: null,
  };

  // Capture payload diagnostics for logging
  const diagnostics: Record<string, unknown> = {
    variant: 'C_full_id_aware',
    payloadTopKeys: Object.keys(body),
    legacyExpectedTopKeys: LEGACY_STEP_D_FIELDS,
    legacyMissingTopKeys: LEGACY_STEP_D_FIELDS.filter((key) => !(key in body)),
    legacyExtraTopKeys: Object.keys(body).filter(
      (key) => !LEGACY_STEP_D_FIELDS.includes(key as (typeof LEGACY_STEP_D_FIELDS)[number]),
    ),
    tvid: body.tvid,
    cplEntryKeys: Object.keys(cplEntry),
    cplEntry,
    propertyCount: property.length,
    propertyIds: property.map((p) => p.PropertyID),
    propertyTvids: property.map((p) => p.tvid),
    buyerCount: buyers.length,
    buyerIds: buyers.map((b) => b.NameID),
    buyerTvids: buyers.map((b) => b.tvid),
    sellerCount: sellers.length,
    sellerIds: sellers.map((s) => s.NameID),
    sellerTvids: sellers.map((s) => s.tvid),
    lenderCount: lenders.length,
    lenderId: lenders[0]?.Id ?? null,
    lenderTvid: lenders[0]?.tvid ?? null,
    purchasePrice: body.purchase_price,
    actionFlags: body.actions,
    missingEntityIds: {
      property: property.some((p) => !p.PropertyID),
      buyers: buyers.some((b) => !b.NameID),
      sellers: sellers.some((s) => !s.NameID),
      lenders: lenders.some((l) => !l.Id),
    },
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
