import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type {
  CplAdapter,
  CplGenerateInput,
  CplGenerateResult,
  CplOrderDetail,
  CplBranch,
} from '../types';
import { MOCK_PDF_BASE64 } from '../types';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';

async function logRequest(params: {
  operation: string; orderId?: number; requestId: string; startedAt: Date;
  success: boolean; durationMs: number; meta?: Record<string, unknown>;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: 'fnf', operation: params.operation, orderId: params.orderId ?? null,
      requestId: params.requestId, startedAt: params.startedAt, endedAt: new Date(),
      success: params.success, httpStatus: null, errorCategory: params.success ? null : 'CPL_ERROR',
      requestMeta: params.meta ?? null, responseMeta: null,
    });
  } catch { /* logging must not break the main flow */ }
}

// ─── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_BRANCHES: CplBranch[] = [
  {
    branchCode: 'FNF-GLN',
    branchName: 'Pacific Coast Title - Glendale',
    agencyName: 'Pacific Coast Title Company',
    address: '100 N Brand Blvd',
    city: 'Glendale',
    state: 'CA',
    zip: '91203',
    underwriterCode: 'FNF-5001',
  },
  {
    branchCode: 'FNF-BUR',
    branchName: 'Pacific Coast Title - Burbank',
    agencyName: 'Pacific Coast Title Company',
    address: '300 E Olive Ave',
    city: 'Burbank',
    state: 'CA',
    zip: '91502',
    underwriterCode: 'FNF-5003',
  },
];

// ─── Mock Adapter ───────────────────────────────────────────────────────────
// Simulates two-tier JWT auth: vendor token → user token → SOAP CPL generation

export const fnfAdapter: CplAdapter = {
  async generateCpl(
    _input: CplGenerateInput,
    _orderDetail: CplOrderDetail
  ): Promise<VendorResult<CplGenerateResult>> {
    const requestId = `fnf-${crypto.randomUUID()}`;
    const start = Date.now();

    try {
      await delay(30);

      // Step 1: Get vendor JWT token
      const _vendorToken = 'mock-fnf-vendor-jwt';

      // Step 2: Exchange for user JWT token
      await delay(20);
      const _userToken = 'mock-fnf-user-jwt';

      // Step 3: SOAP CreateCPL call
      await delay(40);
      const fnfCplId = `FNF-CPL-${Date.now()}`;

      const durationMs = Date.now() - start;
      await logRequest({ operation: 'generate_cpl', requestId, startedAt: new Date(start), success: true, durationMs });

      return vendorSuccess<CplGenerateResult>(
        {
          pdfBase64: MOCK_PDF_BASE64,
          cplId: fnfCplId,
          vendorRefs: {
            fnf_cpl_id: fnfCplId,
            fnf_cpl_number: `CPL-${Math.floor(Math.random() * 900000) + 100000}`,
          },
        },
        { requestId, durationMs }
      );
    } catch (err) {
      const durationMs = Date.now() - start;
      await logRequest({ operation: 'generate_cpl', requestId, startedAt: new Date(start), success: false, durationMs });

      return vendorError<CplGenerateResult>(
        'fnf',
        'CPL_GENERATION_FAILED',
        err instanceof Error ? err.message : 'Unknown FNF error',
        { requestId, durationMs }
      );
    }
  },

  async getBranches(): Promise<VendorResult<CplBranch[]>> {
    const rid = `fnf-${crypto.randomUUID()}`;
    const s = Date.now();
    await delay(30);
    const durationMs = Date.now() - s;
    await logRequest({ operation: 'get_branches', requestId: rid, startedAt: new Date(s), success: true, durationMs });
    return vendorSuccess(MOCK_BRANCHES, { requestId: rid, durationMs });
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
