import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ProposedInsuredInput, ResolvedData } from './proposed-insured';

const NAVY = rgb(0.106, 0.165, 0.29);
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.4, 0.4, 0.4);

export function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

export async function buildPdf(
  input: ProposedInsuredInput,
  resolved: ResolvedData,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);

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
    page.drawLine({ start: { x: margin, y }, end: { x: 612 - margin, y }, thickness: 1.5, color: NAVY });
    y -= 10;
  }

  function gap(px: number) { y -= px; }

  // Header
  drawCenteredText('Pacific Coast Title Company', { size: 16, bold: true, color: NAVY });
  gap(2);

  const branchLine = [resolved.branch.address, resolved.branch.city, `${resolved.branch.state ?? 'CA'} ${resolved.branch.zip ?? ''}`]
    .filter(Boolean).join(', ');
  if (branchLine) drawCenteredText(branchLine, { size: 9, color: GRAY });
  gap(2);
  drawCenteredText(`Issuing Agent for ${resolved.underwriterLabel}`, { size: 9, color: GRAY });
  gap(6);

  drawLine();
  gap(4);

  // Title Officer
  drawText(`Title Officer: ${resolved.titleOfficer.name}`, { bold: true, size: 10 });
  const contactParts: string[] = [];
  if (resolved.titleOfficer.email) contactParts.push(`Email: ${resolved.titleOfficer.email}`);
  if (resolved.titleOfficer.phone) contactParts.push(`Phone: ${resolved.titleOfficer.phone}`);
  if (contactParts.length > 0) drawText(contactParts.join('  |  '), { size: 9, color: GRAY });
  gap(8);

  // Order & Property
  drawText(`Order No.: ${resolved.fileNumber}`, { bold: true, size: 10 });
  const propLine = `${input.propertyAddress}, ${input.propertyCity}, ${input.propertyState} ${input.propertyZipcode}`;
  drawText(`Property: ${propLine}`, { size: 10 });
  gap(6);

  drawLine();
  gap(6);

  // Supplemental Report
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

  // Lender
  drawText('Lender:', { bold: true, size: 10 });
  drawText(input.lenderCompany, { size: 10 });
  if (input.assignmentClause) drawText(input.assignmentClause, { size: 9, color: GRAY });
  const lenderAddr = `${input.lenderAddress}, ${input.lenderCity}, ${input.lenderState ?? 'CA'} ${input.lenderZipcode}`;
  drawText(lenderAddr, { size: 10 });
  gap(10);

  // Borrower
  drawText('Borrower:', { bold: true, size: 10 });
  drawText(input.borrowersVesting, { size: 10 });
  gap(4);
  drawText(`Loan #: ${input.loanNumber}`, { size: 10 });
  drawText(`Loan Amount: ${formatCurrency(input.loanAmount)}`, { size: 10 });
  gap(20);

  // Signature
  page.drawLine({ start: { x: margin, y: y + 2 }, end: { x: margin + 200, y: y + 2 }, thickness: 0.5, color: BLACK });
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
