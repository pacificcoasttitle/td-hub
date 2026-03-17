import { db } from '@/lib/db/client';
import { orders, orderProperties, orderParties } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { uploadDocument } from './service';
import { attachToSoftPro } from './service';

interface ProposedInsuredData {
  fileNumber: string;
  date: string;
  propertyAddress: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  buyerNames: string[];
  sellerNames: string[];
  lenderName: string | null;
  lenderCompany: string | null;
}

export async function generateProposedInsured(
  orderId: number,
  userId: string,
  options?: { attachToSoftpro?: boolean },
): Promise<{ success: boolean; documentId?: number; error?: string }> {
  const [orderRow] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!orderRow) return { success: false, error: 'Order not found' };

  const [property] = await db
    .select()
    .from(orderProperties)
    .where(eq(orderProperties.orderId, orderId))
    .limit(1);

  const parties = await db
    .select()
    .from(orderParties)
    .where(eq(orderParties.orderId, orderId));

  const buyers = parties
    .filter((p) => p.role === 'buyer')
    .map((p) => p.externalName)
    .filter((n): n is string => !!n);

  const sellers = parties
    .filter((p) => p.role === 'seller')
    .map((p) => p.externalName)
    .filter((n): n is string => !!n);

  const lenderParty = parties.find((p) => p.role === 'lender');

  const data: ProposedInsuredData = {
    fileNumber: orderRow.fileNumber,
    date: new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    }),
    propertyAddress: property?.address ?? '',
    city: property?.city ?? '',
    state: property?.state ?? 'CA',
    zip: property?.zip ?? '',
    county: property?.county ?? '',
    buyerNames: buyers.length > 0 ? buyers : ['(Not specified)'],
    sellerNames: sellers.length > 0 ? sellers : ['(Not specified)'],
    lenderName: lenderParty?.externalName ?? null,
    lenderCompany: lenderParty?.externalCompany ?? null,
  };

  const html = buildProposedInsuredHtml(data);
  const buffer = Buffer.from(html, 'utf-8');
  const filename = `proposed_insured_${data.fileNumber}_${Date.now()}.html`;

  try {
    const { documentId } = await uploadDocument({
      orderId,
      file: buffer,
      filename,
      contentType: 'text/html',
      category: 'proposed_insured',
      description: `Proposed Insured letter for ${data.fileNumber}`,
      userId,
    });

    if (options?.attachToSoftpro) {
      try { await attachToSoftPro(documentId); } catch { /* best-effort */ }
    }

    return { success: true, documentId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to generate proposed insured',
    };
  }
}

function buildProposedInsuredHtml(data: ProposedInsuredData): string {
  const fullAddress = [data.propertyAddress, data.city, `${data.state} ${data.zip}`]
    .filter(Boolean)
    .join(', ');

  const buyerList = data.buyerNames.map((n) => `<li>${esc(n)}</li>`).join('\n');
  const sellerList = data.sellerNames.map((n) => `<li>${esc(n)}</li>`).join('\n');

  const lenderSection = data.lenderName || data.lenderCompany
    ? `<div class="section">
        <h3>Lender</h3>
        ${data.lenderCompany ? `<p><strong>${esc(data.lenderCompany)}</strong></p>` : ''}
        ${data.lenderName ? `<p>${esc(data.lenderName)}</p>` : ''}
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Proposed Insured — ${esc(data.fileNumber)}</title>
<style>
  @page { size: letter; margin: 1in; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1a1a2e; line-height: 1.6; margin: 0; padding: 40px; }
  .header { border-bottom: 3px solid #1b2a4a; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { margin: 0; font-size: 22px; color: #1b2a4a; }
  .header p { margin: 4px 0 0; color: #6b7280; font-size: 13px; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 24px; font-size: 14px; }
  .meta .label { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta .value { font-weight: 600; margin-top: 2px; }
  .section { margin-bottom: 20px; }
  .section h3 { font-size: 14px; color: #1b2a4a; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin: 0 0 8px; }
  .section p { margin: 4px 0; font-size: 14px; }
  .section ul { margin: 4px 0; padding-left: 20px; }
  .section li { font-size: 14px; margin-bottom: 2px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
</style>
</head>
<body>
  <div class="header">
    <h1>Pacific Coast Title Company</h1>
    <p>Proposed Insured</p>
  </div>

  <div class="meta">
    <div><span class="label">File Number</span><div class="value">${esc(data.fileNumber)}</div></div>
    <div><span class="label">Date</span><div class="value">${esc(data.date)}</div></div>
    <div><span class="label">County</span><div class="value">${esc(data.county || 'N/A')}</div></div>
  </div>

  <div class="section">
    <h3>Property</h3>
    <p>${esc(fullAddress)}</p>
  </div>

  <div class="section">
    <h3>Proposed Insured (Buyer/Borrower)</h3>
    <ul>${buyerList}</ul>
  </div>

  <div class="section">
    <h3>Seller</h3>
    <ul>${sellerList}</ul>
  </div>

  ${lenderSection}

  <div class="footer">
    <p>Generated by TD Hub — Pacific Coast Title Company</p>
    <p>This document is for informational purposes. Final insured parties are subject to underwriting approval.</p>
  </div>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
