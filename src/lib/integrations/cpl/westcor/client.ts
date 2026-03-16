import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type {
  CplAdapter,
  CplGenerateInput,
  CplGenerateResult,
  CplOrderDetail,
  CplBranch,
  CplForm,
} from '../types';
import { MOCK_PDF_BASE64 } from '../types';
import { db } from '@/lib/db/client';
import { vendorApiLogs, vendorTokens } from '@/lib/db/schema';
import { and, eq, gt } from 'drizzle-orm';

const VENDOR = 'westcor';
const TIMEOUT_MS = 15_000;

// ─── Config ──────────────────────────────────────────────────────────────────

function getConfig() {
  const baseUrl = process.env.WESTCOR_URL;
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
    username: process.env.WESTCOR_USERNAME ?? '',
    password: process.env.WESTCOR_PASSWORD ?? '',
    integrationPartner: process.env.WESTCOR_INTEGRATION_PARTNER ?? '',
  };
}

// ─── Logging ─────────────────────────────────────────────────────────────────

async function logRequest(params: {
  operation: string; orderId?: number; requestId: string; startedAt: Date;
  success: boolean; httpStatus?: number; errorCategory?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: VENDOR, operation: params.operation, orderId: params.orderId ?? null,
      requestId: params.requestId, startedAt: params.startedAt, endedAt: new Date(),
      success: params.success, httpStatus: params.httpStatus ?? null,
      errorCategory: params.errorCategory ?? null,
      requestMeta: params.meta ?? null, responseMeta: null,
    });
  } catch { /* logging must not break the main flow */ }
}

// ─── Token Management ────────────────────────────────────────────────────────

async function getCachedToken(cfg: NonNullable<ReturnType<typeof getConfig>>): Promise<string | null> {
  const rows = await db
    .select()
    .from(vendorTokens)
    .where(and(
      eq(vendorTokens.vendor, VENDOR),
      eq(vendorTokens.tokenType, 'bearer'),
      gt(vendorTokens.expiresAt, new Date()),
    ))
    .limit(1);
  return rows[0]?.token ?? null;
}

async function getToken(cfg: NonNullable<ReturnType<typeof getConfig>>): Promise<string> {
  const cached = await getCachedToken(cfg);
  if (cached) return cached;

  const res = await fetch(`${cfg.baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      username: cfg.username,
      password: cfg.password,
    }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Westcor token request failed: HTTP ${res.status}`);
  }

  const data = await res.json() as { access_token: string; expires_in?: number };
  const token = data.access_token;
  const expiresInSec = data.expires_in ?? 3600;
  const expiresAt = new Date(Date.now() + (expiresInSec - 60) * 1000);

  await db.insert(vendorTokens).values({
    vendor: VENDOR,
    tokenType: 'bearer',
    token,
    expiresAt,
  });

  return token;
}

// ─── Order Create/Update ────────────────────────────────────────────────────

async function createOrUpdateOrder(
  cfg: NonNullable<ReturnType<typeof getConfig>>,
  token: string,
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
): Promise<string> {
  const body = {
    FileNumber: orderDetail.fileNumber,
    PropertyAddress: orderDetail.property?.address ?? '',
    PropertyCity: orderDetail.property?.city ?? '',
    PropertyState: orderDetail.property?.state ?? 'CA',
    PropertyZip: orderDetail.property?.zip ?? '',
    PropertyCounty: orderDetail.property?.county ?? '',
    Buyers: orderDetail.buyers.join('; '),
    Sellers: orderDetail.sellers.join('; '),
    SalesPrice: orderDetail.salesPrice ?? '0',
    LoanAmount: orderDetail.loanAmount ?? '0',
    LenderName: orderDetail.lender?.name ?? '',
    LenderAddress: orderDetail.lender?.address ?? '',
    LenderCity: orderDetail.lender?.city ?? '',
    LenderState: orderDetail.lender?.state ?? '',
    LenderZip: orderDetail.lender?.zip ?? '',
    ...(input.lenderOverrides ?? {}),
  };

  const res = await fetch(`${cfg.baseUrl}/VendorApi/Order/Update`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Integration-Partner': cfg.integrationPartner,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Westcor order update failed: HTTP ${res.status}`);
  }

  const data = await res.json() as { OrderId?: string; orderId?: string; Id?: string };
  return data.OrderId ?? data.orderId ?? data.Id ?? '';
}

// ─── PrepareAddCPL ──────────────────────────────────────────────────────────

async function prepareAddCpl(
  cfg: NonNullable<ReturnType<typeof getConfig>>,
  token: string,
  westcorOrderId: string,
): Promise<CplForm[]> {
  const res = await fetch(`${cfg.baseUrl}/VendorApi/ClosingLetters/PrepareAddCPL/${westcorOrderId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Integration-Partner': cfg.integrationPartner,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Westcor PrepareAddCPL failed: HTTP ${res.status}`);
  }

  const data = await res.json() as { Forms?: Array<{ FormId: string; FormName: string }> };
  return (data.Forms ?? []).map(f => ({ id: f.FormId, name: f.FormName }));
}

// ─── Generate CPL ───────────────────────────────────────────────────────────

async function generateCplPdf(
  cfg: NonNullable<ReturnType<typeof getConfig>>,
  token: string,
  westcorOrderId: string,
  formId: string,
): Promise<{ pdf: string; cplId: string }> {
  const res = await fetch(`${cfg.baseUrl}/VendorApi/ClosingLetters/Generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Integration-Partner': cfg.integrationPartner,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ OrderId: westcorOrderId, FormId: formId }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Westcor CPL generation failed: HTTP ${res.status}`);
  }

  const data = await res.json() as { FileAsBase64?: string; CplId?: string; Id?: string };
  const pdf = data.FileAsBase64 ?? '';
  if (!pdf) throw new Error('Westcor returned empty PDF');

  return { pdf, cplId: data.CplId ?? data.Id ?? `WC-${Date.now()}` };
}

// ─── Form Selection ─────────────────────────────────────────────────────────

export function selectCplForm(
  forms: CplForm[],
  mode: 'single' | 'multiple' = 'single'
): CplForm {
  if (forms.length === 0) {
    throw new Error('No CPL forms available from Westcor');
  }

  if (mode === 'single') {
    const singleMatch = forms.find(
      (f) => /\bsingle\b/i.test(f.name) && !/multiple|blanket/i.test(f.name)
    );
    if (singleMatch) return singleMatch;

    const nonMultiple = forms.find(
      (f) => !/multiple|blanket/i.test(f.name)
    );
    if (nonMultiple) return nonMultiple;
  } else {
    const multiMatch = forms.find(
      (f) => /multiple|blanket/i.test(f.name)
    );
    if (multiMatch) return multiMatch;
  }

  const available = forms.map((f) => `"${f.name}"`).join(', ');
  throw new Error(
    `No matching CPL form for mode "${mode}". Available forms: ${available}`
  );
}

// ─── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_FORMS: CplForm[] = [
  { id: 'form-001', name: 'Standard Single Transaction CPL' },
  { id: 'form-002', name: 'Multiple/Blanket Transaction CPL' },
  { id: 'form-003', name: 'Single Transaction CPL (Short Form)' },
];

const MOCK_BRANCHES: CplBranch[] = [
  {
    branchCode: 'WC-GLN', branchName: 'Pacific Coast Title - Glendale',
    agencyName: 'Pacific Coast Title Company', address: '100 N Brand Blvd',
    city: 'Glendale', state: 'CA', zip: '91203', underwriterCode: 'AG-5001',
  },
  {
    branchCode: 'WC-PAS', branchName: 'Pacific Coast Title - Pasadena',
    agencyName: 'Pacific Coast Title Company', address: '200 E Colorado Blvd',
    city: 'Pasadena', state: 'CA', zip: '91101', underwriterCode: 'AG-5002',
  },
];

// ─── Adapter ────────────────────────────────────────────────────────────────

export const westcorAdapter: CplAdapter = {
  async generateCpl(
    input: CplGenerateInput,
    orderDetail: CplOrderDetail
  ): Promise<VendorResult<CplGenerateResult>> {
    const cfg = getConfig();
    const requestId = `westcor-${crypto.randomUUID()}`;
    const start = Date.now();
    const startedAt = new Date(start);

    if (!cfg) return mockGenerateCpl(input, requestId, startedAt);

    try {
      const token = await getToken(cfg);
      const westcorOrderId = await createOrUpdateOrder(cfg, token, orderDetail, input);
      const forms = await prepareAddCpl(cfg, token, westcorOrderId);
      const form = selectCplForm(forms, input.cplMode ?? 'single');
      const { pdf, cplId } = await generateCplPdf(cfg, token, westcorOrderId, form.id);

      const durationMs = Date.now() - start;
      await logRequest({ operation: 'generate_cpl', orderId: input.orderId, requestId, startedAt, success: true, httpStatus: 200, meta: { westcorOrderId, formId: form.id, formName: form.name } });

      return vendorSuccess<CplGenerateResult>(
        {
          pdfBase64: pdf,
          cplId,
          vendorRefs: {
            westcor_order_id: westcorOrderId,
            westcor_cpl_id: cplId,
            westcor_form_id: form.id,
            westcor_form_name: form.name,
          },
        },
        { requestId, durationMs }
      );
    } catch (err) {
      const durationMs = Date.now() - start;
      await logRequest({ operation: 'generate_cpl', orderId: input.orderId, requestId, startedAt, success: false, errorCategory: 'CPL_ERROR' });
      return vendorError<CplGenerateResult>(
        VENDOR,
        'CPL_GENERATION_FAILED',
        err instanceof Error ? err.message : 'Unknown Westcor error',
        { requestId, durationMs }
      );
    }
  },

  async getBranches(): Promise<VendorResult<CplBranch[]>> {
    const cfg = getConfig();
    const requestId = `westcor-${crypto.randomUUID()}`;
    const startedAt = new Date();

    if (!cfg) {
      await delay(30);
      const durationMs = Date.now() - startedAt.getTime();
      await logRequest({ operation: 'get_branches', requestId, startedAt, success: true, meta: { mock: true } });
      return vendorSuccess(MOCK_BRANCHES, { requestId, durationMs });
    }

    try {
      const token = await getToken(cfg);
      const res = await fetch(`${cfg.baseUrl}/VendorApi/Branches`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Integration-Partner': cfg.integrationPartner,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) throw new Error(`Westcor branches request failed: HTTP ${res.status}`);

      const data = await res.json() as Array<{
        BranchCode?: string; BranchName?: string; AgencyName?: string;
        Address?: string; City?: string; State?: string; Zip?: string;
        Phone?: string; UnderwriterCode?: string;
      }>;

      const branches: CplBranch[] = data.map(b => ({
        branchCode: b.BranchCode ?? '',
        branchName: b.BranchName ?? '',
        agencyName: b.AgencyName,
        address: b.Address,
        city: b.City,
        state: b.State,
        zip: b.Zip,
        phone: b.Phone,
        underwriterCode: b.UnderwriterCode,
      }));

      const durationMs = Date.now() - startedAt.getTime();
      await logRequest({ operation: 'get_branches', requestId, startedAt, success: true, httpStatus: res.status, meta: { count: branches.length } });
      return vendorSuccess(branches, { requestId, durationMs });
    } catch (err) {
      const durationMs = Date.now() - startedAt.getTime();
      await logRequest({ operation: 'get_branches', requestId, startedAt, success: false, errorCategory: 'BRANCHES_ERROR' });
      return vendorError<CplBranch[]>(
        VENDOR,
        'BRANCHES_FAILED',
        err instanceof Error ? err.message : 'Unknown error',
        { requestId, durationMs }
      );
    }
  },
};

// ─── Mock Helpers ───────────────────────────────────────────────────────────

async function mockGenerateCpl(
  input: CplGenerateInput, requestId: string, startedAt: Date,
): Promise<VendorResult<CplGenerateResult>> {
  await delay(100);
  const westcorOrderId = `WCO-${Date.now()}`;
  const form = selectCplForm(MOCK_FORMS, input.cplMode ?? 'single');
  const westcorCplId = `WCCPL-${Date.now()}`;
  const durationMs = Date.now() - startedAt.getTime();
  await logRequest({ operation: 'generate_cpl', requestId, startedAt, success: true, meta: { mock: true } });
  return vendorSuccess<CplGenerateResult>(
    {
      pdfBase64: MOCK_PDF_BASE64,
      cplId: westcorCplId,
      vendorRefs: { westcor_order_id: westcorOrderId, westcor_cpl_id: westcorCplId, westcor_form_id: form.id, westcor_form_name: form.name },
    },
    { requestId, durationMs }
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
