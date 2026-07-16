import { db } from '@/lib/db/client';
import { orders, branches, contacts, companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { uploadDocument, attachToSoftPro } from './service';
import { buildPdf } from './proposed-insured-pdf';

// ─── Input Types ─────────────────────────────────────────────────────────────

export const proposedInsuredInputSchema = z.object({
  lenderCompany: z.string().min(1),
  lenderCompanyId: z.number().int().positive().optional(),
  lenderCompanyLookupCode: z.string().optional(),
  assignmentClause: z.string().optional(),
  lenderAddress: z.string().min(1),
  lenderCity: z.string().min(1),
  lenderState: z.string().optional(),
  lenderZipcode: z.string().min(1),
  isNewLender: z.boolean(),

  propertyAddress: z.string().min(1),
  propertyCity: z.string().min(1),
  propertyState: z.string().min(1),
  propertyZipcode: z.string().min(1),

  titleOfficer: z.string().min(1),
  loanAmount: z.number().min(0),
  loanNumber: z.string(),
  borrowersVesting: z.string().min(1),
  supplementalReportDate: z.string().min(1),
  preliminaryReportDate: z.string().optional(),

  branchId: z.number().int().positive(),
});

export type ProposedInsuredInput = z.infer<typeof proposedInsuredInputSchema>;

export interface ProposedInsuredResult {
  success: boolean;
  documentId?: number;
  downloadUrl?: string;
  base64Pdf?: string;
  error?: string;
}

export interface ResolvedData {
  fileNumber: string;
  productType: string | null;
  titleOfficer: { name: string; email: string | null; phone: string | null };
  branch: { name: string; address: string | null; city: string | null; state: string | null; zip: string | null };
  underwriterLabel: string;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function generateProposedInsured(
  orderId: number,
  userId: string,
  input: ProposedInsuredInput,
): Promise<ProposedInsuredResult> {
  const [orderRow] = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber, productType: orders.productType })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!orderRow) return { success: false, error: 'Order not found' };

  if (input.isNewLender) {
    try { await upsertLenderCompany(input); } catch { /* best-effort */ }
  }

  const titleOfficer = await resolveTitleOfficer(input.titleOfficer);
  const branch = await resolveBranch(input.branchId);
  const underwriterLabel = determineUnderwriter(orderRow.productType);

  const resolved: ResolvedData = { fileNumber: orderRow.fileNumber, productType: orderRow.productType, titleOfficer, branch, underwriterLabel };

  const pdfBuffer = await buildPdf(input, resolved);
  const base64Pdf = pdfBuffer.toString('base64');

  const filename = `PPI-${resolved.fileNumber}.pdf`;

  try {
    const { documentId, storageKey: key } = await uploadDocument({
      orderId, file: pdfBuffer, filename, contentType: 'application/pdf',
      category: 'proposed_insured', description: `Proposed Insured — ${resolved.fileNumber}`, userId,
    });

    attachToSoftPro(documentId, 'desk-file-upload').catch(() => {});

    const awsPath = process.env.AWS_PATH;
    const downloadUrl = awsPath ? `${awsPath}${key}` : undefined;

    return { success: true, documentId, downloadUrl, base64Pdf };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to upload proposed insured' };
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

async function upsertLenderCompany(input: ProposedInsuredInput): Promise<void> {
  if (input.lenderCompanyId) {
    await db.update(companies).set({
      name: input.lenderCompany, address1: input.lenderAddress, city: input.lenderCity,
      state: input.lenderState ?? 'CA', zip: input.lenderZipcode,
      assignmentClause: input.assignmentClause ?? null, lookupCode: input.lenderCompanyLookupCode ?? null, updatedAt: new Date(),
    }).where(eq(companies.id, input.lenderCompanyId));
  } else {
    await db.insert(companies).values({
      name: input.lenderCompany, companyType: 'lender', lookupCode: input.lenderCompanyLookupCode ?? null,
      address1: input.lenderAddress, city: input.lenderCity, state: input.lenderState ?? 'CA',
      zip: input.lenderZipcode, assignmentClause: input.assignmentClause ?? null, sourceSystem: 'td_hub',
    });
  }
}

async function resolveTitleOfficer(titleOfficerInput: string): Promise<ResolvedData['titleOfficer']> {
  const asId = parseInt(titleOfficerInput, 10);
  if (!isNaN(asId)) {
    const [contact] = await db
      .select({ fullName: contacts.fullName, email: contacts.email, phone: contacts.phone })
      .from(contacts).where(eq(contacts.id, asId)).limit(1);
    if (contact) return { name: contact.fullName ?? 'Unknown', email: contact.email, phone: contact.phone };
  }
  return { name: titleOfficerInput, email: null, phone: null };
}

async function resolveBranch(branchId: number): Promise<ResolvedData['branch']> {
  const [row] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (row) return { name: row.name, address: row.address, city: row.city, state: row.state, zip: row.zip };
  return { name: 'Pacific Coast Title Company', address: null, city: null, state: null, zip: null };
}

export function determineUnderwriter(productType: string | null): string {
  if (productType && productType.toLowerCase().includes('full alta')) return 'Commonwealth';
  return 'Westcor';
}

export { getProposedInsuredPrefill } from './proposed-insured-prefill';
