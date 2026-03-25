import type { CplOrderDetail, CplGenerateInput, CplForm } from '../types';

const TIMEOUT_MS = 15_000;
const CPL_TIMEOUT_MS = 30_000;
const PCT_CLOSING_AGENT = 'CA1038';

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

function buildSellers(names: string[]) {
  return names.map((fullName, i) => ({
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

function parsePurchasePrice(val: string | null): number {
  if (!val) return 0;
  return parseInt(String(val).replace(/[^0-9\-]/g, ''), 10) || 0;
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
// Legacy: POST VendorApi/Order/Update/{partner} with $cplPostData

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
    purchase_price: parsePurchasePrice(orderDetail.salesPrice),
    property: buildProperty(orderDetail.property),
    buyers: buildBuyers(orderDetail.buyers),
    sellers: buildSellers(orderDetail.sellers),
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
// Legacy: GET VendorApi/Order/{tvid}/{partner} — used as the base for Step D

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
// Legacy: GET VendorApi/ClosingLetters/PrepareAddCPL/{tvid}/{partner}
// Returns the full CPL template ($resCPL['CPL']) plus available Forms.
// The template is reused in Step D with field overrides.

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

  // Legacy: $resCPL['CPL'] is the object containing Forms + TVID + other metadata
  const cplObj = (data.CPL ?? data) as Record<string, unknown>;
  const rawForms = (cplObj.Forms ?? []) as Array<Record<string, unknown>>;

  const forms: CplForm[] = rawForms.map((f) => ({
    id: String(f.FormId ?? f.FormName ?? ''),
    name: String(f.FormName ?? f.name ?? ''),
  }));

  return { forms, cplTemplate: cplObj };
}

// ─── Step D: Generate CPL PDF ───────────────────────────────────────────────
// Legacy flow (lines 441-525 of Westcor.php):
//   1. $res = GET Order/{tvid}/{partner}  (the full Westcor order)
//   2. $res['cpl'] = array()              (clear any existing CPLs)
//   3. Modify $resCPL['CPL'] with our CPL fields (LetterName, LenderID, etc.)
//   4. $res['cpl'][] = $resCPL['CPL']     (add modified CPL template)
//   5. Overwrite $res property/buyers/sellers/lenders/purchase_price with ours
//   6. Set action flags on $res['actions']
//   7. POST Order/Update with json_encode($res)
//
// We replicate this: take the GET order as base, overlay our data + CPL.

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
): Promise<{ pdf: string; cplId: string }> {
  // Build our data arrays
  const buyers = buildBuyers(orderDetail.buyers);
  const sellers = buildSellers(orderDetail.sellers);
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

  // Legacy: modify the CPL template from PrepareAddCPL ($resCPL['CPL'])
  // TVID is already in the template from PrepareAddCPL — legacy does NOT set it
  const cplEntry: Record<string, unknown> = {
    ...cplTemplate,
    LetterName: selectedFormName,
    FileInformation: null,
    CPLID: -1,
    LenderID: westcorLenderId,
    PolicyProducingAgentAddressID: branch.branchCode,
    PolicyProducingAgentAddress: branch.address,
    PolicyProducingAgentCity: branch.city,
    PolicyProducingAgentState: branch.state,
    PolicyProducingAgentZip: branch.zip,
    ProtectLender: true,
    ClosingAgentNumber: PCT_CLOSING_AGENT,
    IsDualCPL: false,
  };

  // Legacy: merge GET order + our data + CPL entry
  const existingActions = (westcorOrder.actions ?? {}) as Record<string, unknown>;
  const body: Record<string, unknown> = {
    ...westcorOrder,
    cpl: [cplEntry],
    property: buildProperty(orderDetail.property),
    lenders,
    buyers,
    sellers,
    actions: {
      ...existingActions,
      update_property: true,
      update_cpls: true,
      update_buyers: true,
      update_sellers: true,
      update_lender: true,
    },
    purchase_price: parsePurchasePrice(orderDetail.salesPrice),
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
    throw new Error(`Westcor CPL generation failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    cpl?: Array<{
      CPLID?: number;
      cplNumber?: string;
      FileInformation?: { FileAsBase64?: string; FileAsDataVaultFileID?: string };
    }>;
    messages?: { error?: string[] };
  };

  // Legacy: check messages.error first
  if (data.messages?.error && data.messages.error.length > 0) {
    throw new Error(`Westcor CPL error: ${data.messages.error.join('; ')}`);
  }

  // Legacy: use LAST cpl entry — $cplCount = count($resultResCPL['cpl']) - 1
  const cplEntries = data.cpl ?? [];
  const lastCpl = cplEntries[cplEntries.length - 1];
  if (!lastCpl) throw new Error('Westcor returned no CPL entry');

  // Legacy: $resultResCPL['cpl'][$cplCount]['FileInformation']['FileAsBase64']
  const pdf = lastCpl.FileInformation?.FileAsBase64 ?? '';
  if (!pdf) throw new Error('Westcor returned empty CPL PDF');

  // Legacy: $resultResCPL['cpl'][$cplCount]['CPLID']
  const cplId = String(lastCpl.CPLID ?? lastCpl.cplNumber ?? `WC-${Date.now()}`);
  return { pdf, cplId };
}

// ─── Form selection ─────────────────────────────────────────────────────────
// Legacy: Westcor.php selectCplForm() — searches by FormName semantics

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
