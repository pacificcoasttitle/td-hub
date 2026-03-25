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

// ─── Westcor response shape (from Order/Update) ────────────────────────────

export interface WestcorOrderResponse {
  tvid?: number;
  agentnumber?: string;
  agent_file_number?: string;
  partnerCode?: number;
  buyers?: Array<{ NameID?: number; First?: string; Last?: string }>;
  sellers?: Array<{ NameID?: number; First?: string; Last?: string }>;
  lenders?: Array<{ Id?: number; NameID?: number; name?: string }>;
  property?: Array<{ PropertyID?: number }>;
  messages?: { success?: string[]; warning?: string[]; error?: string[] };
}

// ─── Shared body helpers (legacy-exact field names) ─────────────────────────

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

const ACTIONS_CPL = {
  ...ACTIONS_CREATE,
  update_cpls: true,
};

// ─── Step A: Create / sync order ────────────────────────────────────────────

export async function createOrUpdateOrder(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
  branch: WestcorBranchInfo,
): Promise<{ westcorOrderId: string; orderResponse: WestcorOrderResponse }> {
  const body = {
    tvid: 0,
    agentnumber: branch.branchCode,
    agent_file_number: orderDetail.fileNumber,
    email_requestor: '',
    purchase_price: orderDetail.salesPrice
      ? parseInt(String(orderDetail.salesPrice).replace(/[^0-9\-]/g, ''), 10) || 0
      : 0,
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
  const westcorOrderId = String(data.tvid ?? 0);

  return { westcorOrderId, orderResponse: data };
}

// ─── Step B: PrepareAddCPL ──────────────────────────────────────────────────

export async function prepareAddCpl(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  westcorOrderId: string,
): Promise<CplForm[]> {
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
  if (!text) return [];

  const data = JSON.parse(text) as {
    CPL?: { Forms?: Array<{ FormName?: string }> };
    cplForms?: Array<{ id?: number; name?: string }>;
    Forms?: Array<{ FormId?: string; FormName?: string }>;
  };

  const rawForms = data.CPL?.Forms ?? data.cplForms ?? data.Forms ?? [];
  return rawForms.map((f: Record<string, unknown>) => ({
    id: String(f.id ?? f.FormId ?? f.FormName ?? ''),
    name: String(f.name ?? f.FormName ?? ''),
  }));
}

// ─── Step D: Generate CPL PDF (same Order/Update endpoint with cpl array) ──

export async function generateCplPdf(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  westcorOrderId: string,
  form: CplForm,
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
  branch: WestcorBranchInfo,
  westcorLenderId: number,
): Promise<{ pdf: string; cplId: string }> {
  const tvid = parseInt(westcorOrderId, 10) || 0;

  const body = {
    tvid,
    agentnumber: branch.branchCode,
    agent_file_number: orderDetail.fileNumber,
    email_requestor: '',
    purchase_price: orderDetail.salesPrice
      ? parseInt(String(orderDetail.salesPrice).replace(/[^0-9\-]/g, ''), 10) || 0
      : 0,
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
    actions: ACTIONS_CPL,
    partnerCode: parseInt(cfg.integrationPartner, 10) || 0,
    cpl: [{
      TVID: tvid,
      CPLID: -1,
      FileInformation: null,
      LetterName: form.name,
      LenderID: westcorLenderId,
      PolicyProducingAgentAddressID: branch.branchCode,
      PolicyProducingAgentAddress: branch.address,
      PolicyProducingAgentCity: branch.city,
      PolicyProducingAgentState: branch.state,
      PolicyProducingAgentZip: branch.zip,
      ProtectLender: true,
      ClosingAgentNumber: PCT_CLOSING_AGENT,
      IsDualCPL: false,
    }],
    priors: null,
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
      FileInformation?: { FileAsBase64?: string };
      fileInformation?: { fileAsBase64?: string };
    }>;
  };

  const cplEntry = data.cpl?.[0];
  if (!cplEntry) throw new Error('Westcor returned no CPL entry');

  const pdf =
    cplEntry.FileInformation?.FileAsBase64 ??
    cplEntry.fileInformation?.fileAsBase64 ??
    '';
  if (!pdf) throw new Error('Westcor returned empty CPL PDF');

  const cplId = String(cplEntry.CPLID ?? cplEntry.cplNumber ?? `WC-${Date.now()}`);
  return { pdf, cplId };
}

// ─── Get existing order (diagnostic / lookup) ──────────────────────────────

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
