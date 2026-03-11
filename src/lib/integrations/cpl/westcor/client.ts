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
import { vendorApiLogs } from '@/lib/db/schema';

async function logRequest(params: {
  operation: string; orderId?: number; requestId: string; startedAt: Date;
  success: boolean; durationMs: number; meta?: Record<string, unknown>;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: 'westcor', operation: params.operation, orderId: params.orderId ?? null,
      requestId: params.requestId, startedAt: params.startedAt, endedAt: new Date(),
      success: params.success, httpStatus: null, errorCategory: params.success ? null : 'CPL_ERROR',
      requestMeta: params.meta ?? null, responseMeta: null,
    });
  } catch { /* logging must not break the main flow */ }
}

// ─── Form Selection ─────────────────────────────────────────────────────────
// CRITICAL: Must use name-based matching, NEVER array position.
// Legacy bug: hard-coded index [1] silently generated "Multiple Transactions"
// CPLs when Westcor reordered their form list.

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
    branchCode: 'WC-GLN',
    branchName: 'Pacific Coast Title - Glendale',
    agencyName: 'Pacific Coast Title Company',
    address: '100 N Brand Blvd',
    city: 'Glendale',
    state: 'CA',
    zip: '91203',
    underwriterCode: 'AG-5001',
  },
  {
    branchCode: 'WC-PAS',
    branchName: 'Pacific Coast Title - Pasadena',
    agencyName: 'Pacific Coast Title Company',
    address: '200 E Colorado Blvd',
    city: 'Pasadena',
    state: 'CA',
    zip: '91101',
    underwriterCode: 'AG-5002',
  },
];

// ─── Mock Adapter ───────────────────────────────────────────────────────────
// Simulates: get token → create order → PrepareAddCPL → selectCplForm → generate

export const westcorAdapter: CplAdapter = {
  async generateCpl(
    input: CplGenerateInput,
    _orderDetail: CplOrderDetail
  ): Promise<VendorResult<CplGenerateResult>> {
    const requestId = `westcor-${crypto.randomUUID()}`;
    const start = Date.now();

    try {
      await delay(30);

      // Step 1: Simulate OAuth token acquisition
      const _token = 'mock-westcor-access-token';

      // Step 2: Simulate order creation
      await delay(20);
      const westcorOrderId = `WCO-${Date.now()}`;

      // Step 3: Simulate PrepareAddCPL → returns forms list
      await delay(20);
      const form = selectCplForm(MOCK_FORMS, input.cplMode ?? 'single');

      // Step 4: Simulate CPL generation with selected form
      await delay(30);
      const westcorCplId = `WCCPL-${Date.now()}`;

      const durationMs = Date.now() - start;
      await logRequest({ operation: 'generate_cpl', requestId, startedAt: new Date(start), success: true, durationMs });

      return vendorSuccess<CplGenerateResult>(
        {
          pdfBase64: MOCK_PDF_BASE64,
          cplId: westcorCplId,
          vendorRefs: {
            westcor_order_id: westcorOrderId,
            westcor_cpl_id: westcorCplId,
            westcor_form_id: form.id,
            westcor_form_name: form.name,
          },
        },
        { requestId, durationMs }
      );
    } catch (err) {
      const durationMs = Date.now() - start;
      await logRequest({ operation: 'generate_cpl', requestId, startedAt: new Date(start), success: false, durationMs });

      return vendorError<CplGenerateResult>(
        'westcor',
        'CPL_GENERATION_FAILED',
        err instanceof Error ? err.message : 'Unknown Westcor error',
        { requestId, durationMs }
      );
    }
  },

  async getBranches(): Promise<VendorResult<CplBranch[]>> {
    const rid = `westcor-${crypto.randomUUID()}`;
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
