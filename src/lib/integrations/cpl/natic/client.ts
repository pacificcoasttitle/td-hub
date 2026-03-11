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

const MOCK_BRANCHES_NATIC: CplBranch[] = [
  {
    branchCode: 'NATIC-001',
    branchName: 'Pacific Coast Title Company, 100 N Brand Blvd, Glendale, CA 91203',
    agencyName: 'Pacific Coast Title Company',
    address: '100 N Brand Blvd',
    city: 'Glendale',
    state: 'CA',
    zip: '91203',
    underwriterCode: 'UID-NATIC-001',
  },
];

const MOCK_BRANCHES_DOMA: CplBranch[] = [
  {
    branchCode: 'DOMA-001',
    branchName: 'Pacific Coast Title Company, 100 N Brand Blvd, Glendale, CA 91203',
    agencyName: 'Pacific Coast Title Company',
    address: '100 N Brand Blvd',
    city: 'Glendale',
    state: 'CA',
    zip: '91203',
    underwriterCode: 'UID-DOMA-001',
  },
];

// ─── Factory ────────────────────────────────────────────────────────────────
// Shared implementation for NATIC and Doma. Real implementation switches env
// vars (NATIC_USERNAME / DOMA_USERNAME, etc.) based on underwriter param.

function createNaticAdapter(underwriter: 'natic' | 'doma'): CplAdapter {
  const branches = underwriter === 'natic' ? MOCK_BRANCHES_NATIC : MOCK_BRANCHES_DOMA;

  return {
    async generateCpl(
      _input: CplGenerateInput,
      _orderDetail: CplOrderDetail
    ): Promise<VendorResult<CplGenerateResult>> {
      const requestId = `${underwriter}-${crypto.randomUUID()}`;
      const start = Date.now();

      try {
        // Step 1: Simulate /Authorize call (plaintext auth, password + "#" suffix)
        await delay(30);

        // Step 2: Simulate /GetDocuments call with XML body
        await delay(40);
        const cplId = `${underwriter.toUpperCase()}-CPL-${Date.now()}`;

        return vendorSuccess<CplGenerateResult>(
          {
            pdfBase64: MOCK_PDF_BASE64,
            cplId,
            vendorRefs: {
              [`${underwriter}_cpl_id`]: cplId,
              [`${underwriter}_document_id`]: `DOC-${Date.now()}`,
            },
          },
          { requestId, durationMs: Date.now() - start }
        );
      } catch (err) {
        return vendorError<CplGenerateResult>(
          underwriter,
          'CPL_GENERATION_FAILED',
          err instanceof Error ? err.message : `Unknown ${underwriter} error`,
          { requestId, durationMs: Date.now() - start }
        );
      }
    },

    async getBranches(): Promise<VendorResult<CplBranch[]>> {
      await delay(30);
      return vendorSuccess(branches, {
        requestId: `${underwriter}-${crypto.randomUUID()}`,
        durationMs: 30,
      });
    },
  };
}

export const naticAdapter = createNaticAdapter('natic');
export const domaAdapter = createNaticAdapter('doma');

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
