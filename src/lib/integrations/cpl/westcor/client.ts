import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type {
  CplAdapter, CplGenerateInput, CplGenerateResult,
  CplOrderDetail, CplBranch, CplForm,
} from '../types';
import { MOCK_PDF_BASE64 } from '../types';
import { db } from '@/lib/db/client';
import { vendorApiLogs, vendorTokens, cplBranches } from '@/lib/db/schema';
import { and, eq, gt } from 'drizzle-orm';
import { getToken, cachedGroups, mapGroupsToBranches } from './auth';
import type { WestcorGroup } from './auth';
import {
  createOrUpdateOrder, getOrder, prepareAddCpl, generateCplPdf, selectCplForm,
} from './payloads';
import type { WestcorBranchInfo } from './payloads';

const VENDOR = 'westcor';

function getConfig() {
  const baseUrl = process.env.WESTCOR_URL;
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    username: process.env.WESTCOR_USERNAME ?? '',
    password: process.env.WESTCOR_PASSWORD ?? '',
    integrationPartner: process.env.WESTCOR_INTEGRATION_PARTNER ?? '',
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

      const [branchRow] = await db
        .select()
        .from(cplBranches)
        .where(eq(cplBranches.id, input.branchId))
        .limit(1);

      const branch: WestcorBranchInfo = {
        branchCode: branchRow?.branchCode ?? cfg.integrationPartner,
        agencyName: branchRow?.agencyName ?? 'Pacific Coast Title Company',
        address: branchRow?.address ?? '',
        city: branchRow?.city ?? '',
        state: branchRow?.state ?? 'CA',
        zip: branchRow?.zip ?? '',
      };

      // Step A: Create order in Westcor (legacy: POST Order/Update)
      await logRequest({ operation: 'create_order', orderId: input.orderId, requestId, startedAt: new Date(), success: true, meta: { step: 'start', branchCode: branch.branchCode } });
      const { westcorOrderId, orderResponse } = await createOrUpdateOrder(cfg, token, orderDetail, input, branch);

      // Step B: GET the full order from Westcor (legacy: GET Order/{tvid}/{partner})
      const westcorOrder = await getOrder(cfg, token, westcorOrderId);

      // Step C: PrepareAddCPL — returns forms + CPL template (legacy: $resCPL['CPL'])
      const { forms, cplTemplate } = await prepareAddCpl(cfg, token, westcorOrderId);
      const form = selectCplForm(forms, input.cplMode ?? 'single');

      // Step D: Generate CPL — merge GET order + CPL template + our data (legacy flow)
      const { pdf, cplId } = await generateCplPdf(
        cfg, token, westcorOrder, cplTemplate, form.name,
        orderDetail, input, branch, orderResponse,
      );

      const durationMs = Date.now() - start;
      await logRequest({
        operation: 'generate_cpl', orderId: input.orderId, requestId, startedAt, success: true, httpStatus: 200,
        meta: { westcorOrderId, formId: form.id, formName: form.name, cplId },
      });

      return vendorSuccess<CplGenerateResult>(
        { pdfBase64: pdf, cplId, vendorRefs: { westcor_order_id: westcorOrderId, westcor_cpl_id: cplId, westcor_form_id: form.id, westcor_form_name: form.name } },
        { requestId, durationMs }
      );
    } catch (err) {
      const durationMs = Date.now() - start;
      await logRequest({ operation: 'generate_cpl', orderId: input.orderId, requestId, startedAt, success: false, errorCategory: 'CPL_ERROR', meta: { error: err instanceof Error ? err.message : 'unknown' } });
      return vendorError<CplGenerateResult>(VENDOR, 'CPL_GENERATION_FAILED', err instanceof Error ? err.message : 'Unknown Westcor error', { requestId, durationMs });
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

      if (cachedGroups && cachedGroups.length > 0) {
        const branches = mapGroupsToBranches(cachedGroups);
        const durationMs = Date.now() - startedAt.getTime();
        await logRequest({ operation: 'get_branches', requestId, startedAt, success: true, httpStatus: 200, meta: { count: branches.length, source: 'token_groups' } });
        return vendorSuccess(branches, { requestId, durationMs });
      }

      const rows = await db
        .select()
        .from(vendorTokens)
        .where(and(eq(vendorTokens.vendor, VENDOR), eq(vendorTokens.tokenType, 'bearer'), gt(vendorTokens.expiresAt, new Date())))
        .limit(1);

      const storedMeta = rows[0]?.metadata as { groups?: WestcorGroup[] | string } | null;
      let storedGroups: WestcorGroup[] = [];
      if (typeof storedMeta?.groups === 'string') {
        try { storedGroups = JSON.parse(storedMeta.groups); } catch { /* ignore */ }
      } else if (Array.isArray(storedMeta?.groups)) {
        storedGroups = storedMeta.groups;
      }
      if (storedGroups.length > 0) {
        const branches = mapGroupsToBranches(storedGroups);
        const durationMs = Date.now() - startedAt.getTime();
        await logRequest({ operation: 'get_branches', requestId, startedAt, success: true, meta: { count: branches.length, source: 'stored_metadata' } });
        return vendorSuccess(branches, { requestId, durationMs });
      }

      const durationMs = Date.now() - startedAt.getTime();
      await logRequest({ operation: 'get_branches', requestId, startedAt, success: true, meta: { count: 0, source: 'none' } });
      return vendorSuccess([], { requestId, durationMs });
    } catch (err) {
      const durationMs = Date.now() - startedAt.getTime();
      await logRequest({ operation: 'get_branches', requestId, startedAt, success: false, errorCategory: 'BRANCHES_ERROR' });
      return vendorError<CplBranch[]>(VENDOR, 'BRANCHES_FAILED', err instanceof Error ? err.message : 'Unknown error', { requestId, durationMs });
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
    { pdfBase64: MOCK_PDF_BASE64, cplId: westcorCplId, vendorRefs: { westcor_order_id: westcorOrderId, westcor_cpl_id: westcorCplId, westcor_form_id: form.id, westcor_form_name: form.name } },
    { requestId, durationMs }
  );
}

export { selectCplForm } from './payloads';
