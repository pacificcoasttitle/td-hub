import type { CplOrderDetail, CplGenerateInput, CplForm } from '../types';

const TIMEOUT_MS = 15_000;

export interface WestcorOrderResponse {
  id?: number;
  westcor_order_id?: number;
  orderBuyers?: Array<{ id?: number; firstName?: string; lastName?: string }>;
  orderSellers?: Array<{ id?: number; firstName?: string; lastName?: string }>;
  orderLenders?: Array<{ id?: number; name?: string }>;
}

export async function createOrUpdateOrder(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
): Promise<{ westcorOrderId: string; orderResponse: WestcorOrderResponse }> {
  const lenderOverrides = input.lenderOverrides ?? {};
  const lender = orderDetail.lender;
  const prop = orderDetail.property;

  const body = {
    agent: cfg.integrationPartner,
    fileNumber: orderDetail.fileNumber,
    requestorEmail: '',
    purchasePrice: orderDetail.salesPrice ? parseFloat(orderDetail.salesPrice) || 0 : 0,
    property: {
      address1: prop?.address ?? '',
      city: prop?.city ?? '',
      state: prop?.state ?? 'CA',
      zip: prop?.zip ?? '',
      county: prop?.county ?? '',
    },
    buyers: orderDetail.buyers.map(parseName),
    sellers: orderDetail.sellers.map(parseName),
    lenders: lender ? [{
      name: lenderOverrides.name ?? lender.name ?? '',
      address1: lenderOverrides.address ?? lender.address ?? '',
      city: lenderOverrides.city ?? lender.city ?? '',
      state: lenderOverrides.state ?? lender.state ?? '',
      zip: lenderOverrides.zip ?? lender.zip ?? '',
      loanAmount: orderDetail.loanAmount ? parseFloat(orderDetail.loanAmount) || 0 : 0,
    }] : [],
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
  const westcorOrderId = String(data.id ?? data.westcor_order_id ?? '');
  if (!westcorOrderId) throw new Error('Westcor returned no order ID');

  return { westcorOrderId, orderResponse: data };
}

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

export async function prepareAddCpl(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  westcorOrderId: string,
): Promise<CplForm[]> {
  const res = await fetch(
    `${cfg.baseUrl}VendorApi/ClosingLetters/PrepareAddCPL/${westcorOrderId}/${cfg.integrationPartner}`,
    { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`Westcor PrepareAddCPL failed: HTTP ${res.status}`);

  const data = await res.json() as {
    cplForms?: Array<{ id?: number; name?: string }>;
    Forms?: Array<{ FormId: string; FormName: string }>;
  };
  const rawForms = data.cplForms ?? data.Forms ?? [];
  return rawForms.map((f: Record<string, unknown>) => ({
    id: String(f.id ?? f.FormId ?? ''),
    name: String(f.name ?? f.FormName ?? ''),
  }));
}

export async function generateCplPdf(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  westcorOrderId: string,
  formId: string,
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
): Promise<{ pdf: string; cplId: string }> {
  const lenderOverrides = input.lenderOverrides ?? {};
  const lender = orderDetail.lender;
  const prop = orderDetail.property;

  const body = {
    id: parseInt(westcorOrderId, 10) || 0,
    agent: cfg.integrationPartner,
    fileNumber: orderDetail.fileNumber,
    requestorEmail: '',
    purchasePrice: orderDetail.salesPrice ? parseFloat(orderDetail.salesPrice) || 0 : 0,
    property: {
      address1: prop?.address ?? '',
      city: prop?.city ?? '',
      state: prop?.state ?? 'CA',
      zip: prop?.zip ?? '',
      county: prop?.county ?? '',
    },
    buyers: orderDetail.buyers.map(parseName),
    sellers: orderDetail.sellers.map(parseName),
    lenders: lender ? [{
      name: lenderOverrides.name ?? lender.name ?? '',
      address1: lenderOverrides.address ?? lender.address ?? '',
      city: lenderOverrides.city ?? lender.city ?? '',
      state: lenderOverrides.state ?? lender.state ?? '',
      zip: lenderOverrides.zip ?? lender.zip ?? '',
      loanAmount: orderDetail.loanAmount ? parseFloat(orderDetail.loanAmount) || 0 : 0,
    }] : [],
    cpl: [{
      cplFormId: parseInt(formId, 10) || 0,
      protectLender: true,
      isDualCPL: false,
    }],
  };

  const res = await fetch(
    `${cfg.baseUrl}VendorApi/Order/Update/${cfg.integrationPartner}`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Westcor CPL generation failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    cpl?: Array<{
      id?: number;
      cplNumber?: string;
      fileInformation?: { fileAsBase64?: string };
      FileInformation?: { FileAsBase64?: string };
    }>;
  };

  const cplEntry = data.cpl?.[0];
  if (!cplEntry) throw new Error('Westcor returned no CPL entry');

  const pdf = cplEntry.fileInformation?.fileAsBase64 ?? cplEntry.FileInformation?.FileAsBase64 ?? '';
  if (!pdf) throw new Error('Westcor returned empty CPL PDF');

  const cplId = String(cplEntry.id ?? cplEntry.cplNumber ?? `WC-${Date.now()}`);
  return { pdf, cplId };
}

export function selectCplForm(
  forms: CplForm[],
  mode: 'single' | 'multiple' = 'single'
): CplForm {
  if (forms.length === 0) throw new Error('No CPL forms available from Westcor');

  if (mode === 'single') {
    const singleMatch = forms.find((f) => /\bsingle\b/i.test(f.name) && !/multiple|blanket/i.test(f.name));
    if (singleMatch) return singleMatch;
    const nonMultiple = forms.find((f) => !/multiple|blanket/i.test(f.name));
    if (nonMultiple) return nonMultiple;
  } else {
    const multiMatch = forms.find((f) => /multiple|blanket/i.test(f.name));
    if (multiMatch) return multiMatch;
  }

  const available = forms.map((f) => `"${f.name}"`).join(', ');
  throw new Error(`No matching CPL form for mode "${mode}". Available forms: ${available}`);
}

export function parseName(fullName: string): { firstName: string; lastName: string } {
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
