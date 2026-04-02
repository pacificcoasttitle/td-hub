import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type {
  CplAdapter, CplGenerateInput, CplGenerateResult,
  CplOrderDetail, CplBranch,
} from '../types';
import { MOCK_PDF_BASE64 } from '../types';
import { db } from '@/lib/db/client';
import { vendorApiLogs, cplBranches, orderExternalRefs } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { getVendorToken, getUserToken } from './auth';
import { getCplForms, generateCplSoap, EditCplEmptyError } from './soap';
import type { FnfBranchInfo, FnfGenerateCplParams } from './soap';

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

async function loadBranch(branchId: number): Promise<FnfBranchInfo> {
  const [row] = await db
    .select()
    .from(cplBranches)
    .where(and(eq(cplBranches.id, branchId), eq(cplBranches.isActive, true)))
    .limit(1);

  if (!row) throw new Error(`FNF branch ${branchId} not found or inactive`);

  return {
    agentNumber: row.branchCode ?? '',
    underwriterCode: row.underwriterCode ?? '',
    address: row.address ?? '',
    city: row.city ?? '',
    state: row.state ?? 'CA',
    zip: row.zip ?? '',
    phone: row.phone ?? '',
  };
}

async function getExistingDocumentId(orderId: number): Promise<string | null> {
  const [ref] = await db
    .select({ refValue: orderExternalRefs.refValue })
    .from(orderExternalRefs)
    .where(
      and(
        eq(orderExternalRefs.orderId, orderId),
        eq(orderExternalRefs.system, 'fnf'),
        eq(orderExternalRefs.refType, 'fnf_document_id'),
      )
    )
    .limit(1);
  return ref?.refValue ?? null;
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
      // Step 1: Authenticate
      const vendorToken = await getVendorToken(cfg);
      const userToken = await getUserToken(cfg, vendorToken);

      // Step 2: Load branch/agent info (CLUP)
      const branch = await loadBranch(input.branchId);
      await logRequest({
        operation: 'get_agents', orderId: input.orderId, requestId, startedAt: new Date(),
        success: true, meta: { agentNumber: branch.agentNumber, underwriterCode: branch.underwriterCode },
      });

      // Step 3: Resolve property — legacy uses cpl_proposed_property_* (user overrides)
      const prop = orderDetail.property;
      const propAddr = input.propertyOverrides?.address ?? prop?.address ?? '';
      const propCity = input.propertyOverrides?.city ?? prop?.city ?? '';
      const propState = input.propertyOverrides?.state ?? prop?.state ?? 'CA';
      const propZip = input.propertyOverrides?.zip ?? prop?.zip ?? '';
      const propCounty = input.propertyOverrides?.county ?? prop?.county ?? '';

      // Step 4: GetCPLList
      const forms = await getCplForms(cfg, vendorToken, branch, orderDetail.fileNumber, propState, input.orderId);
      await logRequest({
        operation: 'get_cpl_list', orderId: input.orderId, requestId, startedAt: new Date(),
        success: true, meta: { formCount: forms.length, forms: forms.map((f) => f.name) },
      });

      // Step 5: Select form — legacy hardcodes: 'Standard CPL_' + state
      const formName = `Standard CPL_${propState}`;

      // Step 6: Check for existing DocumentId (create vs edit)
      const existingDocId = await getExistingDocumentId(input.orderId);

      // Resolve borrower/lender — legacy uses borrowers_vesting and lender overrides
      const lender = orderDetail.lender;
      const buyerNames = orderDetail.buyers.join('; ');
      const borrowerVesting = input.borrowerNamesOverride || buyerNames || '';

      const soapParams: FnfGenerateCplParams = {
        fileNumber: orderDetail.fileNumber,
        branch,
        formName,
        onBehalfOfUser: cfg.onBehalfOfUser,
        userToken,
        borrowerVesting,
        lenderName: input.lenderOverrides?.name ?? lender?.name ?? '',
        lenderAttnName: input.lenderContactName ?? '',
        lenderAddress: input.lenderOverrides?.address ?? lender?.address ?? '',
        lenderCity: input.lenderOverrides?.city ?? lender?.city ?? '',
        lenderState: input.lenderOverrides?.state ?? lender?.state ?? '',
        lenderZip: input.lenderOverrides?.zip ?? lender?.zip ?? '',
        lenderAssignmentClause: input.assignmentClause ?? '',
        loanNumber: input.loanNumberOverride ?? '',
        propertyAddress: propAddr,
        propertyCity: propCity,
        propertyState: propState,
        propertyZip: propZip,
        propertyCounty: propCounty,
        documentId: existingDocId,
      };

      // Step 6: CreateCPL or EditCPL
      let result;
      const isEdit = !!existingDocId;

      try {
        result = await generateCplSoap(cfg, vendorToken, soapParams, input.orderId);
        await logRequest({
          operation: isEdit ? 'edit_cpl' : 'create_cpl',
          orderId: input.orderId, requestId, startedAt: new Date(),
          success: true, meta: { formName, documentId: result.documentId, cplId: result.cplId, isEdit },
        });
      } catch (err) {
        // Legacy: if EditCPL returns empty, fall back to CreateCPL
        if (isEdit && err instanceof EditCplEmptyError) {
          await logRequest({
            operation: 'edit_cpl', orderId: input.orderId, requestId, startedAt: new Date(),
            success: false, errorCategory: 'EDIT_EMPTY', meta: { fallbackToCreate: true },
          });
          soapParams.documentId = null;
          result = await generateCplSoap(cfg, vendorToken, soapParams, input.orderId);
          await logRequest({
            operation: 'create_cpl', orderId: input.orderId, requestId, startedAt: new Date(),
            success: true, meta: { formName, documentId: result.documentId, cplId: result.cplId, fallbackFromEdit: true },
          });
        } else {
          throw err;
        }
      }

      // Step 7: Log PDF parse
      await logRequest({
        operation: 'parse_pdf', orderId: input.orderId, requestId, startedAt: new Date(),
        success: true, meta: { pdfSizeBytes: result.pdf.length, documentId: result.documentId },
      });

      const durationMs = Date.now() - start;
      return vendorSuccess<CplGenerateResult>(
        {
          pdfBase64: result.pdf,
          cplId: result.cplId,
          vendorRefs: {
            fnf_cpl_id: result.cplId,
            fnf_cpl_number: result.cplNumber || `CPL-${Date.now()}`,
            fnf_form_name: formName,
            fnf_document_id: result.documentId,
          },
        },
        { requestId, durationMs },
      );
    } catch (err) {
      const durationMs = Date.now() - start;
      await logRequest({
        operation: 'generate_cpl', orderId: input.orderId, requestId, startedAt,
        success: false, errorCategory: 'CPL_ERROR',
        meta: { error: err instanceof Error ? err.message : 'unknown' },
      });
      return vendorError<CplGenerateResult>(
        VENDOR, 'CPL_GENERATION_FAILED',
        err instanceof Error ? err.message : 'Unknown FNF error',
        { requestId, durationMs },
      );
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

    const rows = await db
      .select()
      .from(cplBranches)
      .where(and(eq(cplBranches.underwriter, 'fnf'), eq(cplBranches.isActive, true)))
      .orderBy(asc(cplBranches.branchName));

    const branches: CplBranch[] = rows.map((r) => ({
      branchCode: r.branchCode ?? '',
      branchName: r.branchName ?? '',
      agencyName: r.agencyName ?? '',
      address: r.address ?? '',
      city: r.city ?? '',
      state: r.state ?? '',
      zip: r.zip ?? '',
      phone: r.phone ?? '',
      underwriterCode: r.underwriterCode ?? '',
    }));

    const durationMs = Date.now() - s;
    await logRequest({ operation: 'get_branches', requestId: rid, startedAt: new Date(s), success: true, meta: { count: branches.length } });
    return vendorSuccess(branches, { requestId: rid, durationMs });
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
    {
      pdfBase64: MOCK_PDF_BASE64, cplId: fnfCplId,
      vendorRefs: { fnf_cpl_id: fnfCplId, fnf_cpl_number: `CPL-${Math.floor(Math.random() * 900000) + 100000}` },
    },
    { requestId, durationMs },
  );
}
