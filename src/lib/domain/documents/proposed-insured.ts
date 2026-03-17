import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { db } from '@/lib/db/client';
import { orders, branches, contacts, companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { uploadDocument, attachToSoftPro } from './service';

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface ProposedInsuredInput {
  lenderCompany: string;
  lenderCompanyId?: number;
  lenderCompanyLookupCode?: string;
  assignmentClause?: string;
  lenderAddress: string;
  lenderCity: string;
  lenderState?: string;
  lenderZipcode: string;
  isNewLender: boolean;

  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZipcode: string;

  titleOfficer: string;
  loanAmount: number;
  loanNumber: string;
  borrowersVesting: string;
  supplementalReportDate: string;
  preliminaryReportDate?: string;

  branchId: number;
}

export interface ProposedInsuredResult {
  success: boolean;
  documentId?: number;
  downloadUrl?: string;
  base64Pdf?: string;
  error?: string;
}

interface ResolvedData {
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
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
      productType: orders.productType,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!orderRow) return { success: false, error: 'Order not found' };

  // Step a: create/update lender company if new
  if (input.isNewLender) {
    try {
      await upsertLenderCompany(input);
    } catch { /* best-effort — don't block PDF generation */ }
  }

  // Step b & c: resolve title officer and branch
  const titleOfficer = await resolveTitleOfficer(input.titleOfficer);
  const branch = await resolveBranch(input.branchId);

  // Step d: determine underwriter label
  const underwriterLabel = determineUnderwriter(orderRow.productType);

  const resolved: ResolvedData = {
    fileNumber: orderRow.fileNumber,
    productType: orderRow.productType,
    titleOfficer,
    branch,
    underwriterLabel,
  };

  // Step e & f: build PDF
  const pdfBuffer = await buildPdf(input, resolved);
  const base64Pdf = pdfBuffer.toString('base64');

  // Step g & h: upload to S3
  const filename = `PPI-${resolved.fileNumber}.pdf`;
  const storageKey = `proposed-insured/${resolved.fileNumber}/${filename}`;

  try {
    const { documentId, storageKey: key } = await uploadDocument({
      orderId,
      file: pdfBuffer,
      filename,
      contentType: 'application/pdf',
      category: 'proposed_insured',
      description: `Proposed Insured — ${resolved.fileNumber}`,
      userId,
    });

    // Step j: attach to SoftPro (fire-and-forget)
    attachToSoftPro(documentId).catch(() => {});

    const awsPath = process.env.AWS_PATH;
    const downloadUrl = awsPath ? `${awsPath}${key}` : undefined;

    return { success: true, documentId, downloadUrl, base64Pdf };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to upload proposed insured',
    };
  }
}

// ─── Prefill Data ────────────────────────────────────────────────────────────

export async function getProposedInsuredPrefill(orderId: number) {
  const [orderRow] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!orderRow) return null;

  const { default: orderProperties } = await import('@/lib/db/schema/orders').then(m => ({ default: m.orderProperties }));
  const { default: orderParties } = await import('@/lib/db/schema/orders').then(m => ({ default: m.orderParties }));

  const [property] = await db
    .select()
    .from(orderProperties)
    .where(eq(orderProperties.orderId, orderId))
    .limit(1);

  const parties = await db
    .select()
    .from(orderParties)
    .where(eq(orderParties.orderId, orderId));

  const lenderParty = parties.find(p => p.role === 'lender');
  const buyers = parties
    .filter(p => p.role === 'buyer')
    .map(p => p.externalName)
    .filter((n): n is string => !!n);

  let titleOfficerData: { name: string; email: string | null; phone: string | null } | null = null;
  if (orderRow.titleOfficerId) {
    const [contact] = await db
      .select({ fullName: contacts.fullName, email: contacts.email, phone: contacts.phone })
      .from(contacts)
      .where(eq(contacts.id, orderRow.titleOfficerId))
      .limit(1);
    if (contact) {
      titleOfficerData = { name: contact.fullName ?? '', email: contact.email, phone: contact.phone };
    }
  }

  let branchData: { id: number; name: string; address: string | null; city: string | null; state: string | null; zip: string | null } | null = null;
  if (orderRow.branchId) {
    const [b] = await db.select().from(branches).where(eq(branches.id, orderRow.branchId)).limit(1);
    if (b) {
      branchData = { id: b.id, name: b.name, address: b.address, city: b.city, state: b.state, zip: b.zip };
    }
  }

  let lenderCompanyData: { id: number; name: string; lookupCode: string | null; assignmentClause: string | null; address1: string | null; city: string | null; state: string | null; zip: string | null } | null = null;
  if (lenderParty?.externalCompany) {
    const [company] = await db
      .select({
        id: companies.id,
        name: companies.name,
        lookupCode: companies.lookupCode,
        assignmentClause: companies.assignmentClause,
        address1: companies.address1,
        city: companies.city,
        state: companies.state,
        zip: companies.zip,
      })
      .from(companies)
      .where(eq(companies.name, lenderParty.externalCompany))
      .limit(1);
    if (company) lenderCompanyData = company;
  }

  return {
    fileNumber: orderRow.fileNumber,
    productType: orderRow.productType,
    underwriterLabel: determineUnderwriter(orderRow.productType),

    property: {
      address: property?.address ?? '',
      city: property?.city ?? '',
      state: property?.state ?? 'CA',
      zipcode: property?.zip ?? '',
    },

    lender: lenderCompanyData
      ? {
          company: lenderCompanyData.name,
          companyId: lenderCompanyData.id,
          lookupCode: lenderCompanyData.lookupCode ?? '',
          assignmentClause: lenderCompanyData.assignmentClause ?? '',
          address: lenderCompanyData.address1 ?? '',
          city: lenderCompanyData.city ?? '',
          state: lenderCompanyData.state ?? '',
          zipcode: lenderCompanyData.zip ?? '',
        }
      : {
          company: lenderParty?.externalCompany ?? '',
          companyId: null,
          lookupCode: '',
          assignmentClause: '',
          address: '',
          city: '',
          state: '',
          zipcode: '',
        },

    titleOfficer: titleOfficerData
      ? { id: orderRow.titleOfficerId!, ...titleOfficerData }
      : null,

    branch: branchData,

    borrowersVesting: buyers.join('; '),
    loanAmount: orderRow.loanAmount ? parseFloat(orderRow.loanAmount) : 0,
    loanNumber: '',
    salesPrice: orderRow.salesPrice ? parseFloat(orderRow.salesPrice) : 0,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

async function upsertLenderCompany(input: ProposedInsuredInput): Promise<void> {
  if (input.lenderCompanyId) {
    await db.update(companies).set({
      name: input.lenderCompany,
      address1: input.lenderAddress,
      city: input.lenderCity,
      state: input.lenderState ?? 'CA',
      zip: input.lenderZipcode,
      assignmentClause: input.assignmentClause ?? null,
      lookupCode: input.lenderCompanyLookupCode ?? null,
      updatedAt: new Date(),
    }).where(eq(companies.id, input.lenderCompanyId));
  } else {
    await db.insert(companies).values({
      name: input.lenderCompany,
      companyType: 'lender',
      lookupCode: input.lenderCompanyLookupCode ?? null,
      address1: input.lenderAddress,
      city: input.lenderCity,
      state: input.lenderState ?? 'CA',
      zip: input.lenderZipcode,
      assignmentClause: input.assignmentClause ?? null,
      sourceSystem: 'td_hub',
    });
  }
}

async function resolveTitleOfficer(
  titleOfficerInput: string,
): Promise<ResolvedData['titleOfficer']> {
  const asId = parseInt(titleOfficerInput, 10);
  if (!isNaN(asId)) {
    const [contact] = await db
      .select({ fullName: contacts.fullName, email: contacts.email, phone: contacts.phone })
      .from(contacts)
      .where(eq(contacts.id, asId))
      .limit(1);
    if (contact) {
      return { name: contact.fullName ?? 'Unknown', email: contact.email, phone: contact.phone };
    }
  }
  return { name: titleOfficerInput, email: null, phone: null };
}

async function resolveBranch(branchId: number): Promise<ResolvedData['branch']> {
  const [row] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (row) {
    return { name: row.name, address: row.address, city: row.city, state: row.state, zip: row.zip };
  }
  return { name: 'Pacific Coast Title Company', address: null, city: null, state: null, zip: null };
}

function determineUnderwriter(productType: string | null): string {
  if (productType && productType.toLowerCase().includes('full alta')) {
    return 'Commonwealth';
  }
  return 'Westcor';
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

// ─── PDF Generation via pdf-lib ──────────────────────────────────────────────

const NAVY = rgb(0.106, 0.165, 0.29); // #1B2A4A
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.4, 0.4, 0.4);

async function buildPdf(
  input: ProposedInsuredInput,
  resolved: ResolvedData,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // Letter size

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 60;
  const pageWidth = 612 - margin * 2;
  let y = 740;

  function drawText(text: string, opts: {
    x?: number; size?: number; bold?: boolean;
    color?: typeof BLACK; maxWidth?: number;
  } = {}) {
    const font = opts.bold ? helveticaBold : helvetica;
    const size = opts.size ?? 10;
    const x = opts.x ?? margin;
    const color = opts.color ?? BLACK;
    const maxWidth = opts.maxWidth ?? pageWidth;

    const lines = wrapText(text, font, size, maxWidth);
    for (const line of lines) {
      if (y < 50) return;
      page.drawText(line, { x, y, size, font, color });
      y -= size + 4;
    }
  }

  function drawCenteredText(text: string, opts: { size?: number; bold?: boolean; color?: typeof BLACK } = {}) {
    const font = opts.bold ? helveticaBold : helvetica;
    const size = opts.size ?? 10;
    const color = opts.color ?? BLACK;
    const width = font.widthOfTextAtSize(text, size);
    const x = (612 - width) / 2;
    if (y < 50) return;
    page.drawText(text, { x, y, size, font, color });
    y -= size + 4;
  }

  function drawLine() {
    if (y < 50) return;
    page.drawLine({
      start: { x: margin, y },
      end: { x: 612 - margin, y },
      thickness: 1.5,
      color: NAVY,
    });
    y -= 10;
  }

  function gap(px: number) { y -= px; }

  // ── Header ──
  drawCenteredText('Pacific Coast Title Company', { size: 16, bold: true, color: NAVY });
  gap(2);

  const branchLine = [resolved.branch.address, resolved.branch.city, `${resolved.branch.state ?? 'CA'} ${resolved.branch.zip ?? ''}`]
    .filter(Boolean).join(', ');
  if (branchLine) {
    drawCenteredText(branchLine, { size: 9, color: GRAY });
  }
  gap(2);
  drawCenteredText(`Issuing Agent for ${resolved.underwriterLabel}`, { size: 9, color: GRAY });
  gap(6);

  drawLine();
  gap(4);

  // ── Title Officer ──
  drawText(`Title Officer: ${resolved.titleOfficer.name}`, { bold: true, size: 10 });
  const contactParts: string[] = [];
  if (resolved.titleOfficer.email) contactParts.push(`Email: ${resolved.titleOfficer.email}`);
  if (resolved.titleOfficer.phone) contactParts.push(`Phone: ${resolved.titleOfficer.phone}`);
  if (contactParts.length > 0) {
    drawText(contactParts.join('  |  '), { size: 9, color: GRAY });
  }
  gap(8);

  // ── Order & Property ──
  drawText(`Order No.: ${resolved.fileNumber}`, { bold: true, size: 10 });
  const propLine = `${input.propertyAddress}, ${input.propertyCity}, ${input.propertyState} ${input.propertyZipcode}`;
  drawText(`Property: ${propLine}`, { size: 10 });
  gap(6);

  drawLine();
  gap(6);

  // ── Supplemental Report ──
  drawText(`Date: ${input.supplementalReportDate}`, { bold: true, size: 10 });
  gap(4);
  drawText('Supplemental Report', { bold: true, size: 12, color: NAVY });
  gap(4);
  drawText(
    `The Company hereby supplements Preliminary Report No. ${resolved.fileNumber}` +
    (input.preliminaryReportDate ? ` dated ${input.preliminaryReportDate}` : '') +
    ' as follows:',
    { size: 10 },
  );
  gap(10);

  // ── Lender ──
  drawText('Lender:', { bold: true, size: 10 });
  drawText(input.lenderCompany, { size: 10 });
  if (input.assignmentClause) {
    drawText(input.assignmentClause, { size: 9, color: GRAY });
  }
  const lenderAddr = `${input.lenderAddress}, ${input.lenderCity}, ${input.lenderState ?? 'CA'} ${input.lenderZipcode}`;
  drawText(lenderAddr, { size: 10 });
  gap(10);

  // ── Borrower ──
  drawText('Borrower:', { bold: true, size: 10 });
  drawText(input.borrowersVesting, { size: 10 });
  gap(4);
  drawText(`Loan #: ${input.loanNumber}`, { size: 10 });
  drawText(`Loan Amount: ${formatCurrency(input.loanAmount)}`, { size: 10 });
  gap(20);

  // ── Signature ──
  page.drawLine({
    start: { x: margin, y: y + 2 },
    end: { x: margin + 200, y: y + 2 },
    thickness: 0.5,
    color: BLACK,
  });
  gap(6);
  drawText(resolved.titleOfficer.name, { bold: true, size: 10 });
  drawText('Title Officer', { size: 9, color: GRAY });
  drawText('Pacific Coast Title Company', { size: 9, color: GRAY });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

function wrapText(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return [text];

  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
