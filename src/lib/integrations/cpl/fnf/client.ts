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

      return vendorSuccess<CplGenerateResult>(
        {
          pdfBase64: MOCK_PDF_BASE64,
          cplId: fnfCplId,
          vendorRefs: {
            fnf_cpl_id: fnfCplId,
            fnf_cpl_number: `CPL-${Math.floor(Math.random() * 900000) + 100000}`,
          },
        },
        { requestId, durationMs: Date.now() - start }
      );
    } catch (err) {
      return vendorError<CplGenerateResult>(
        'fnf',
        'CPL_GENERATION_FAILED',
        err instanceof Error ? err.message : 'Unknown FNF error',
        { requestId, durationMs: Date.now() - start }
      );
    }
  },

  async getBranches(): Promise<VendorResult<CplBranch[]>> {
    await delay(30);
    return vendorSuccess(MOCK_BRANCHES, {
      requestId: `fnf-${crypto.randomUUID()}`,
      durationMs: 30,
    });
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
