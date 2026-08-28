import { db } from '@/lib/db/client';
import { resolveBorrowers } from './borrower-resolution';
import {
  cplBranches,
  orderExternalRefs,
  cplErrorLogs,
  documents,
  orders,
  orderParties,
  orderProperties,
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
  const orderDetail = buildOrderDetail(
    order, input.lenderOverrides, input.propertyOverrides, input.borrowerNamesOverride,
  );

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

  // Non-blocking findings ride the `errors` array, which the route returns as
  // `warnings` on a success. The letter exists; these say what was thin.
  if (cplResult.warnings?.length) errors.push(...cplResult.warnings);
  if (orderDetail.borrowerNote) errors.push(orderDetail.borrowerNote);

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
    const attachResult = await attachToSoftPro(documentId, 'CPL');
    if (!attachResult.success) {
      errors.push(`SoftPro attach: ${attachResult.error ?? 'failed'}`);
    }
  } catch (err) {
    errors.push(
      `SoftPro attach error: ${err instanceof Error ? err.message : 'unknown'}`
    );
  }

  // j. Persist user-entered data back to the order (COALESCE — only if null)
  try {
    await persistCplInputToOrder(input, order);
  } catch (err) {
    errors.push(
      `Save-back: ${err instanceof Error ? err.message : 'unknown'}`
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
  lenderOverrides?: CplGenerateInput['lenderOverrides'],
  propertyOverrides?: CplGenerateInput['propertyOverrides'],
  borrowerNamesOverride?: string,
): CplOrderDetail {
  // The borrower follows legacy's chain: what the operator typed, then the
  // order's buyer parties, then the owner of record — except on a purchase,
  // where the owner of record is the seller. See borrower-resolution.ts.
  //
  // Until now the operator's entry was collected by the modal, carried all the
  // way here as borrowerNamesOverride, and then never passed to this function,
  // so the preflight rejected orders on a value it was holding.
  const resolved = resolveBorrowers({
    override: borrowerNamesOverride,
    buyerParties: order.parties
      .filter((p) => p.role === 'buyer')
      .map((p) => p.externalName ?? '')
      .filter((n) => n.trim() !== ''),
    primaryOwner: order.property?.primaryOwner ?? null,
    secondaryOwner: order.property?.secondaryOwner ?? null,
    transactionType: order.transactionType ?? null,
  });
  const buyers = resolved.names;

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

  const dbProp = order.property;
  const property = propertyOverrides
    ? {
        address: propertyOverrides.address ?? dbProp?.address ?? null,
        city: propertyOverrides.city ?? dbProp?.city ?? null,
        state: propertyOverrides.state ?? dbProp?.state ?? null,
        zip: propertyOverrides.zip ?? dbProp?.zip ?? null,
        county: propertyOverrides.county ?? dbProp?.county ?? null,
      }
    : dbProp
      ? {
          address: dbProp.address,
          city: dbProp.city,
          state: dbProp.state,
          zip: dbProp.zip,
          county: dbProp.county,
        }
      : null;

  return {
    orderId: order.id,
    fileNumber: order.fileNumber,
    transactionType: order.transactionType ?? null,
    property,
    buyers,
    borrowerNote: resolved.note,
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

async function persistCplInputToOrder(
  input: CplGenerateInput,
  order: OrderWithDetail,
): Promise<void> {
  // COALESCE updates to orders table (only if currently null)
  const orderUpdates: Record<string, string> = {};
  if (input.salesAmountOverride && !order.salesPrice) {
    orderUpdates.salesPrice = input.salesAmountOverride;
  }
  if (input.loanAmountOverride && !order.loanAmount) {
    orderUpdates.loanAmount = input.loanAmountOverride;
  }
  if (Object.keys(orderUpdates).length > 0) {
    await db.update(orders).set(orderUpdates).where(eq(orders.id, input.orderId));
  }

  // Persist the borrower the operator typed, into the column legacy actually
  // used for it. order_properties.borrowers_vesting has existed all along and
  // is populated on 0 of 8,047 rows because nothing has ever written it.
  //
  // COALESCE-style like the two above: only fill it when it is empty, so a
  // regenerated CPL never quietly rewrites a borrower somebody set earlier.
  if (input.borrowerNamesOverride?.trim() && !order.property?.borrowersVesting) {
    await db
      .update(orderProperties)
      .set({ borrowersVesting: input.borrowerNamesOverride.trim() })
      .where(eq(orderProperties.orderId, input.orderId));
  }

  // Upsert lender party (company name + contact name)
  if (input.lenderOverrides?.name) {
    const existingLender = order.parties.find((p) => p.role === 'lender');
    if (existingLender) {
      await db
        .update(orderParties)
        .set({
          externalCompany: input.lenderOverrides.name,
          externalName: input.lenderContactName ?? existingLender.externalName,
        })
        .where(eq(orderParties.id, existingLender.id));
    } else {
      await db.insert(orderParties).values({
        orderId: input.orderId,
        role: 'lender',
        externalCompany: input.lenderOverrides.name,
        externalName: input.lenderContactName ?? null,
        isPrimary: true,
      });
    }
  }

  // Store all CPL-specific fields in order_external_refs for round-trip
  const cplRefs: Record<string, string> = {};
  if (input.lenderOverrides?.address) cplRefs.cpl_lender_address = input.lenderOverrides.address;
  if (input.lenderOverrides?.city)    cplRefs.cpl_lender_city = input.lenderOverrides.city;
  if (input.lenderOverrides?.state)   cplRefs.cpl_lender_state = input.lenderOverrides.state;
  if (input.lenderOverrides?.zip)     cplRefs.cpl_lender_zip = input.lenderOverrides.zip;
  if (input.assignmentClause)         cplRefs.cpl_assignment_clause = input.assignmentClause;
  if (input.loanNumberOverride)       cplRefs.cpl_loan_number = input.loanNumberOverride;
  if (input.lenderContactName)        cplRefs.cpl_lender_contact = input.lenderContactName;
  cplRefs.cpl_branch_id = String(input.branchId);

  const system = input.underwriter as typeof orderExternalRefs.system.enumValues[number];
  for (const [refType, refValue] of Object.entries(cplRefs)) {
    await db
      .insert(orderExternalRefs)
      .values({ orderId: input.orderId, system, refType, refValue })
      .onConflictDoUpdate({
        target: [orderExternalRefs.orderId, orderExternalRefs.system, orderExternalRefs.refType],
        set: { refValue },
      });
  }
}
