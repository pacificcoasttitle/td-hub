const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hub.pctitle.com';

const PCT_NAVY = '#1a365d';
const PCT_GOLD = '#d4a739';
const TEXT_GRAY = '#4a5568';
const BORDER_GRAY = '#e2e8f0';

export interface OrderEmailData {
  fileNumber: string;
  address?: string | null;
  closingDate?: string | null;
}

export interface DocumentEmailData extends OrderEmailData {
  category: string;
}

interface EmailTemplate {
  subject: string;
  html: string;
}

function layout(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;padding:0;background:#f7fafc;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
  <tr>
    <td style="background:${PCT_NAVY};padding:20px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">
            Pacific Coast Title
          </td>
          <td align="right" style="color:${PCT_GOLD};font-size:12px;text-transform:uppercase;letter-spacing:1px;">
            ${escapeHtml(title)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;color:${TEXT_GRAY};font-size:15px;line-height:1.6;">
      ${body}
    </td>
  </tr>
  <tr>
    <td style="padding:0 32px 24px;border-top:1px solid ${BORDER_GRAY};">
      <p style="font-size:12px;color:#a0aec0;margin:16px 0 0;">
        Pacific Coast Title Company &bull; Automated notification<br/>
        <a href="${APP_URL}" style="color:${PCT_GOLD};text-decoration:none;">hub.pctitle.com</a>
      </p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`.trim();
}

function orderDetailRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:#718096;border-bottom:1px solid ${BORDER_GRAY};">${label}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:${PCT_NAVY};border-bottom:1px solid ${BORDER_GRAY};">${escapeHtml(value)}</td>
    </tr>`;
}

function orderDetailsTable(data: OrderEmailData): string {
  let rows = orderDetailRow('File Number', data.fileNumber);
  if (data.address) rows += orderDetailRow('Property', data.address);
  if (data.closingDate) rows += orderDetailRow('Date', data.closingDate);

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;border-radius:6px;margin:16px 0 24px;border:1px solid ${BORDER_GRAY};">
      ${rows}
    </table>`;
}

function portalButton(text: string): string {
  return `
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background:${PCT_NAVY};border-radius:6px;padding:12px 28px;">
          <a href="${APP_URL}/orders" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">${text}</a>
        </td>
      </tr>
    </table>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Templates ──────────────────────────────────────────────────────────────

export function orderClosedTemplate(data: OrderEmailData): EmailTemplate {
  const body = `
    <h2 style="color:${PCT_NAVY};margin:0 0 8px;font-size:22px;">Order Closed</h2>
    <p style="margin:0 0 16px;">
      The following order has been <span style="color:${PCT_GOLD};font-weight:600;">closed</span>.
    </p>
    ${orderDetailsTable(data)}
    <p>All parties have been notified. Please review the final documents in the portal.</p>
    ${portalButton('View Order Details')}
  `;

  return {
    subject: `Your Order ${data.fileNumber} has been closed`,
    html: layout('Order Closed', body),
  };
}

export function milestoneRecordingTemplate(data: OrderEmailData): EmailTemplate {
  const body = `
    <h2 style="color:${PCT_NAVY};margin:0 0 8px;font-size:22px;">Recording Confirmed</h2>
    <p style="margin:0 0 16px;">
      Recording has been <span style="color:${PCT_GOLD};font-weight:600;">confirmed</span> for this order.
    </p>
    ${orderDetailsTable(data)}
    <p>The recording confirmation has been received and the order is progressing.</p>
    ${portalButton('View Order')}
  `;

  return {
    subject: `Recording confirmed for ${data.fileNumber}${data.address ? ` at ${data.address}` : ''}`,
    html: layout('Recording', body),
  };
}

export function milestoneDisbursementTemplate(data: OrderEmailData): EmailTemplate {
  const body = `
    <h2 style="color:${PCT_NAVY};margin:0 0 8px;font-size:22px;">Disbursement Completed</h2>
    <p style="margin:0 0 16px;">
      Disbursement has been <span style="color:${PCT_GOLD};font-weight:600;">completed</span> for this order.
    </p>
    ${orderDetailsTable(data)}
    <p>Funds have been disbursed. Please verify receipt and review details in the portal.</p>
    ${portalButton('View Order')}
  `;

  return {
    subject: `Disbursement completed for ${data.fileNumber}`,
    html: layout('Disbursement', body),
  };
}

// ─── Order Confirmation ─────────────────────────────────────────────────────

export interface OrderConfirmationData {
  fileNumber: string;
  address?: string | null;
  transactionType?: string | null;
  productType?: string | null;
  buyerName?: string | null;
  sellerName?: string | null;
  escrowOfficer?: string | null;
  lenderName?: string | null;
  listingAgent?: string | null;
  titleOfficer?: string | null;
  hasDocuments: boolean;
}

export function orderConfirmationTemplate(data: OrderConfirmationData): EmailTemplate {
  let detailRows = orderDetailRow('File Number', data.fileNumber);
  if (data.address) detailRows += orderDetailRow('Property', data.address);
  if (data.transactionType) detailRows += orderDetailRow('Transaction Type', data.transactionType);
  if (data.productType) detailRows += orderDetailRow('Product Type', data.productType);

  let partiesHtml = '';
  const partyList: Array<[string, string | null | undefined]> = [
    ['Buyer', data.buyerName],
    ['Seller', data.sellerName],
    ['Escrow Officer', data.escrowOfficer],
    ['Lender', data.lenderName],
    ['Listing Agent', data.listingAgent],
    ['Title Officer', data.titleOfficer],
  ];
  const hasParties = partyList.some(([, v]) => v);
  if (hasParties) {
    const rows = partyList
      .filter(([, v]) => v)
      .map(([label, val]) => orderDetailRow(label, val!))
      .join('');
    partiesHtml = `
      <h3 style="color:${PCT_NAVY};margin:24px 0 8px;font-size:16px;">Parties</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;border-radius:6px;border:1px solid ${BORDER_GRAY};">
        ${rows}
      </table>`;
  }

  const docNote = data.hasDocuments
    ? `<p style="margin:16px 0 0;"><strong>Documents attached:</strong> Legal Vesting, Tax, Grant Deed</p>`
    : `<p style="margin:16px 0 0;color:#718096;">Title documents will be available shortly and will be sent in a follow-up email.</p>`;

  const body = `
    <h2 style="color:${PCT_NAVY};margin:0 0 8px;font-size:22px;">Open Order Confirmation</h2>
    <p style="margin:0 0 16px;">
      A new order has been <span style="color:${PCT_GOLD};font-weight:600;">opened</span> and is being processed.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;border-radius:6px;margin:16px 0 0;border:1px solid ${BORDER_GRAY};">
      ${detailRows}
    </table>
    ${partiesHtml}
    ${docNote}
    ${portalButton('View Order in Portal')}
  `;

  return {
    subject: `Open Order Confirmation - ${data.fileNumber}`,
    html: layout('Order Confirmation', body),
  };
}

// ─── Document Received ──────────────────────────────────────────────────────

export function documentReceivedTemplate(data: DocumentEmailData): EmailTemplate {
  const categoryLabel = data.category.charAt(0).toUpperCase() + data.category.slice(1);

  const body = `
    <h2 style="color:${PCT_NAVY};margin:0 0 8px;font-size:22px;">New Document Available</h2>
    <p style="margin:0 0 16px;">
      A new <span style="color:${PCT_GOLD};font-weight:600;">${escapeHtml(categoryLabel)}</span> document has been added to this order.
    </p>
    ${orderDetailsTable(data)}
    <p>You can view and download the document from the portal.</p>
    ${portalButton('View Documents')}
  `;

  return {
    subject: `New ${categoryLabel.toLowerCase()} document for Order ${data.fileNumber}`,
    html: layout('Document', body),
  };
}
