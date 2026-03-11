import { db } from '@/lib/db/client';
import {
  cplBranches,
  orderExternalRefs,
  cplErrorLogs,
  documents,
} from '@/lib/db/schema';
import { eq, and, asc, sql } from 'drizzle-orm';
import { getOrderById } from '@/lib/domain/orders/service';
import {
  uploadDocument,
  attachToSoftPro,
} from '@/lib/domain/documents/service';
import { westcorAdapter } from '@/lib/integrations/cpl/westcor/client';
import { fnfAdapter } from '@/lib/integrations/cpl/fnf/client';
import { naticAdapter, domaAdapter } from '@/lib/integrations/cpl/natic/client';
import type {
  CplGenerateInput,
  CplOrderDetail,
  CplAdapter,
  Underwriter,
} from '@/lib/integrations/cpl/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CplGenerateServiceResult {
  success: boolean;
  documentId?: number;
  errors: string[];
}

// ─── Adapter Registry ───────────────────────────────────────────────────────

const ADAPTERS: Record<Underwriter, CplAdapter> = {
  westcor: westcorAdapter,
  fnf: fnfAdapter,
  natic: naticAdapter,
  doma: domaAdapter,
};

// ─── Generate CPL ───────────────────────────────────────────────────────────

export async function generateCpl(
  input: CplGenerateInput,
  userId: string
): Promise<CplGenerateServiceResult> {
  const errors: string[] = [];

  // a. Load order detail with property and parties
  const order = await getOrderById(input.orderId);
  if (!order) {
    return { success: false, errors: ['Order not found'] };
  }

  // b. Load CPL branch
  const [branch] = await db
    .select()
    .from(cplBranches)
    .where(
      and(
        eq(cplBranches.id, input.branchId),
        eq(cplBranches.isActive, true)
      )
    )
    .limit(1);

  if (!branch) {
    return { success: false, errors: ['CPL branch not found or inactive'] };
  }

  // c. Build order detail for the adapter
  const orderDetail = buildOrderDetail(order, input.lenderOverrides);

  // d. Pick adapter
  const adapter = ADAPTERS[input.underwriter];

  // e. Call adapter
  const result = await adapter.generateCpl(input, orderDetail);

  if (!result.success) {
    const errorMsg = result.error?.message ?? 'CPL generation failed';
    errors.push(errorMsg);

    await logCplError(input, order.fileNumber, errorMsg);
    return { success: false, errors };
  }

  const cplResult = result.data!;

  // f. Decode base64 PDF → upload to S3
  const pdfBuffer = Buffer.from(cplResult.pdfBase64, 'base64');

  const cplCount = await getCplDocumentCount(input.orderId);
  const filename = `${input.underwriter}_${order.fileNumber}_${cplCount + 1}.pdf`;

  let documentId: number;
  try {
    const uploadResult = await uploadDocument({
      orderId: input.orderId,
      file: pdfBuffer,
      filename,
      contentType: 'application/pdf',
      category: 'cpl',
      description: `CPL - ${input.underwriter.toUpperCase()} - ${order.fileNumber}`,
      userId,
    });
    documentId = uploadResult.documentId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Document upload failed';
    errors.push(msg);
    await logCplError(input, order.fileNumber, msg);
    return { success: false, errors };
  }

  // h. Store vendor refs in order_external_refs
  try {
    await storeVendorRefs(input.orderId, input.underwriter, cplResult.vendorRefs);
  } catch (err) {
    errors.push(
      `Vendor refs storage failed: ${err instanceof Error ? err.message : 'unknown'}`
    );
  }

  // i. Optionally attach to SoftPro (best-effort, don't fail the whole operation)
  try {
    const attachResult = await attachToSoftPro(documentId);
    if (!attachResult.success) {
      errors.push(`SoftPro attach: ${attachResult.error ?? 'failed'}`);
    }
  } catch (err) {
    errors.push(
      `SoftPro attach error: ${err instanceof Error ? err.message : 'unknown'}`
    );
  }

  return {
    success: true,
    documentId,
    errors,
  };
}

// ─── Branch Queries ─────────────────────────────────────────────────────────

export async function getCplBranches(underwriter?: Underwriter) {
  const conditions = [eq(cplBranches.isActive, true)];
  if (underwriter) {
    conditions.push(eq(cplBranches.underwriter, underwriter));
  }

  return db
    .select()
    .from(cplBranches)
    .where(and(...conditions))
    .orderBy(asc(cplBranches.branchName));
}

export async function getCplBranchesAll() {
  const all = await db
    .select()
    .from(cplBranches)
    .where(eq(cplBranches.isActive, true))
    .orderBy(asc(cplBranches.underwriter), asc(cplBranches.branchName));

  const grouped: Record<string, typeof all> = {};
  for (const branch of all) {
    const uw = branch.underwriter;
    if (!grouped[uw]) grouped[uw] = [];
    grouped[uw].push(branch);
  }
  return grouped;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

type OrderWithDetail = NonNullable<Awaited<ReturnType<typeof getOrderById>>>;

function buildOrderDetail(
  order: OrderWithDetail,
  lenderOverrides?: CplGenerateInput['lenderOverrides']
): CplOrderDetail {
  const buyers = order.parties
    .filter((p) => p.role === 'buyer')
    .map((p) => p.externalName ?? 'Unknown Buyer');

  const sellers = order.parties
    .filter((p) => p.role === 'seller')
    .map((p) => p.externalName ?? 'Unknown Seller');

  const lenderParty = order.parties.find((p) => p.role === 'lender');

  const lender = lenderOverrides
    ? {
        name: lenderOverrides.name ?? null,
        address: lenderOverrides.address ?? null,
        city: lenderOverrides.city ?? null,
        state: lenderOverrides.state ?? null,
        zip: lenderOverrides.zip ?? null,
      }
    : lenderParty
      ? {
          name:
            lenderParty.externalCompany ??
            lenderParty.externalName ??
            null,
          address: null,
          city: null,
          state: null,
          zip: null,
        }
      : null;

  return {
    orderId: order.id,
    fileNumber: order.fileNumber,
    property: order.property
      ? {
          address: order.property.address,
          city: order.property.city,
          state: order.property.state,
          zip: order.property.zip,
          county: order.property.county,
        }
      : null,
    buyers,
    sellers,
    lender,
    salesPrice: order.salesPrice,
    loanAmount: order.loanAmount,
  };
}

async function getCplDocumentCount(orderId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(and(eq(documents.orderId, orderId), eq(documents.category, 'cpl')));
  return Number(result[0]?.count ?? 0);
}

async function storeVendorRefs(
  orderId: number,
  underwriter: Underwriter,
  vendorRefs: Record<string, string>
): Promise<void> {
  const system = underwriter as typeof orderExternalRefs.system.enumValues[number];

  for (const [refType, refValue] of Object.entries(vendorRefs)) {
    await db
      .insert(orderExternalRefs)
      .values({ orderId, system, refType, refValue })
      .onConflictDoUpdate({
        target: [orderExternalRefs.orderId, orderExternalRefs.system, orderExternalRefs.refType],
        set: { refValue },
      });
  }
}

async function logCplError(
  input: CplGenerateInput,
  fileNumber: string,
  error: string
): Promise<void> {
  try {
    await db.insert(cplErrorLogs).values({
      orderId: input.orderId,
      fileNumber,
      underwriter: input.underwriter,
      error,
      context: 'cpl_generation',
    });
  } catch {
    // Don't let error logging fail the main flow
  }
}
