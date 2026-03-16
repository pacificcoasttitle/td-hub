import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type {
  CplAdapter, CplGenerateInput, CplGenerateResult,
  CplOrderDetail, CplBranch, CplForm,
} from '../types';
import { MOCK_PDF_BASE64 } from '../types';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import { getVendorToken, getUserToken } from './auth';
import { getCplForms, generateCplSoap } from './soap';

const VENDOR = 'fnf';

function getConfig() {
  const vendorUrl = process.env.FNF_VENDOR_URL;
  if (!vendorUrl) return null;
  return {
    vendorUrl: vendorUrl.endsWith('/') ? vendorUrl : `${vendorUrl}/`,
    userUrl: (process.env.FNF_USER_URL ?? '').replace(/\/$/, '') + '/',
    cplUrl: (process.env.FNF_CPL_URL ?? '').replace(/\/$/, '') + '/',
    clientId: process.env.FNF_CLIENT_ID ?? '',
    secretKey: process.env.FNF_SECRET_KEY ?? '',
    onBehalfOfUser: process.env.FNF_ON_BEHALF_OF_USER ?? '',
  };
}

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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function selectCplForm(forms: CplForm[], mode: 'single' | 'multiple' = 'single'): CplForm {
  if (forms.length === 0) throw new Error('No CPL forms available from FNF');
  if (mode === 'single') {
    const match = forms.find((f) => /\bsingle\b/i.test(f.name) && !/multiple|blanket/i.test(f.name));
    if (match) return match;
    const fallback = forms.find((f) => !/multiple|blanket/i.test(f.name));
    if (fallback) return fallback;
  } else {
    const match = forms.find((f) => /multiple|blanket/i.test(f.name));
    if (match) return match;
  }
  return forms[0]!;
}

// ─── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_BRANCHES: CplBranch[] = [
  {
    branchCode: 'FNF-GLN', branchName: 'Pacific Coast Title - Glendale',
    agencyName: 'Pacific Coast Title Company', address: '100 N Brand Blvd',
    city: 'Glendale', state: 'CA', zip: '91203', underwriterCode: 'FNF-5001',
  },
  {
    branchCode: 'FNF-BUR', branchName: 'Pacific Coast Title - Burbank',
    agencyName: 'Pacific Coast Title Company', address: '300 E Olive Ave',
    city: 'Burbank', state: 'CA', zip: '91502', underwriterCode: 'FNF-5003',
  },
];

// ─── Adapter ────────────────────────────────────────────────────────────────

export const fnfAdapter: CplAdapter = {
  async generateCpl(
    input: CplGenerateInput,
    orderDetail: CplOrderDetail,
  ): Promise<VendorResult<CplGenerateResult>> {
    const cfg = getConfig();
    const requestId = `fnf-${crypto.randomUUID()}`;
    const start = Date.now();
    const startedAt = new Date(start);

    if (!cfg) return mockGenerateCpl(input, requestId, startedAt);

    try {
      const vendorToken = await getVendorToken(cfg);
      const userToken = await getUserToken(cfg, vendorToken);

      const forms = await getCplForms(cfg, vendorToken, userToken, orderDetail);
      await logRequest({
        operation: 'get_cpl_forms', orderId: input.orderId, requestId, startedAt: new Date(), success: true,
        meta: { formCount: forms.length },
      });

      const form = selectCplForm(forms, input.cplMode ?? 'single');
      const { pdf, cplId, cplNumber } = await generateCplSoap(cfg, vendorToken, userToken, orderDetail, form.id);

      const durationMs = Date.now() - start;
      await logRequest({
        operation: 'generate_cpl', orderId: input.orderId, requestId, startedAt, success: true, httpStatus: 200,
        meta: { formId: form.id, formName: form.name, cplId, cplNumber },
      });

      return vendorSuccess<CplGenerateResult>(
        { pdfBase64: pdf, cplId, vendorRefs: { fnf_cpl_id: cplId, fnf_cpl_number: cplNumber || `CPL-${Date.now()}`, fnf_form_id: form.id, fnf_form_name: form.name } },
        { requestId, durationMs },
      );
    } catch (err) {
      const durationMs = Date.now() - start;
      await logRequest({
        operation: 'generate_cpl', orderId: input.orderId, requestId, startedAt, success: false,
        errorCategory: 'CPL_ERROR', meta: { error: err instanceof Error ? err.message : 'unknown' },
      });
      return vendorError<CplGenerateResult>(VENDOR, 'CPL_GENERATION_FAILED', err instanceof Error ? err.message : 'Unknown FNF error', { requestId, durationMs });
    }
  },

  async getBranches(): Promise<VendorResult<CplBranch[]>> {
    const cfg = getConfig();
    const rid = `fnf-${crypto.randomUUID()}`;
    const s = Date.now();

    if (!cfg) {
      await delay(30);
      const durationMs = Date.now() - s;
      await logRequest({ operation: 'get_branches', requestId: rid, startedAt: new Date(s), success: true, meta: { mock: true } });
      return vendorSuccess(MOCK_BRANCHES, { requestId: rid, durationMs });
    }

    const durationMs = Date.now() - s;
    await logRequest({ operation: 'get_branches', requestId: rid, startedAt: new Date(s), success: true, meta: { source: 'static' } });
    return vendorSuccess(MOCK_BRANCHES, { requestId: rid, durationMs });
  },
};

// ─── Mock Helpers ───────────────────────────────────────────────────────────

async function mockGenerateCpl(
  input: CplGenerateInput, requestId: string, startedAt: Date,
): Promise<VendorResult<CplGenerateResult>> {
  await delay(90);
  const fnfCplId = `FNF-CPL-${Date.now()}`;
  const durationMs = Date.now() - startedAt.getTime();
  await logRequest({ operation: 'generate_cpl', requestId, startedAt, success: true, meta: { mock: true } });
  return vendorSuccess<CplGenerateResult>(
    { pdfBase64: MOCK_PDF_BASE64, cplId: fnfCplId, vendorRefs: { fnf_cpl_id: fnfCplId, fnf_cpl_number: `CPL-${Math.floor(Math.random() * 900000) + 100000}` } },
    { requestId, durationMs },
  );
}
