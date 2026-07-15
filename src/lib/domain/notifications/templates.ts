import {
  BG_LIGHT,
  BORDER_SOFT,
  PCT_NAVY,
  PCT_ORANGE,
  button,
  detailsRow,
  emailLayout,
  esc,
} from './email-layout';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hub.pctitle.com';

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

function orderDetailRow(label: string, value: string): string {
  return detailsRow(label, value);
}

function orderDetailsTable(data: OrderEmailData): string {
  let rows = orderDetailRow('File Number', data.fileNumber);
  if (data.address) rows += orderDetailRow('Property', data.address);
  if (data.closingDate) rows += orderDetailRow('Date', data.closingDate);

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${BG_LIGHT};border-radius:6px;margin:16px 0 24px;border:1px solid ${BORDER_SOFT};">
      ${rows}
    </table>`;
}

function portalButton(text: string): string {
  return `
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        ${button(text, `${APP_URL}/orders`)}
      </tr>
    </table>`;
}

// ─── Templates ──────────────────────────────────────────────────────────────

export function orderClosedTemplate(data: OrderEmailData): EmailTemplate {
  const body = `
    <h2 style="color:${PCT_NAVY};margin:0 0 8px;font-size:22px;">Order Closed</h2>
    <p style="margin:0 0 16px;">
      The following order has been <span style="color:${PCT_ORANGE};font-weight:600;">closed</span>.
    </p>
    ${orderDetailsTable(data)}
    <p>All parties have been notified. Please review the final documents in the portal.</p>
    ${portalButton('View Order Details')}
  `;

  return {
    subject: `Your Order ${data.fileNumber} has been closed`,
    html: emailLayout('Order Closed', body),
  };
}

export function milestoneRecordingTemplate(data: OrderEmailData): EmailTemplate {
  const body = `
    <h2 style="color:${PCT_NAVY};margin:0 0 8px;font-size:22px;">Recording Confirmed</h2>
    <p style="margin:0 0 16px;">
      Recording has been <span style="color:${PCT_ORANGE};font-weight:600;">confirmed</span> for this order.
    </p>
    ${orderDetailsTable(data)}
    <p>The recording confirmation has been received and the order is progressing.</p>
    ${portalButton('View Order')}
  `;

  return {
    subject: `Recording confirmed for ${data.fileNumber}${data.address ? ` at ${data.address}` : ''}`,
    html: emailLayout('Recording', body),
  };
}

export function milestoneDisbursementTemplate(data: OrderEmailData): EmailTemplate {
  const body = `
    <h2 style="color:${PCT_NAVY};margin:0 0 8px;font-size:22px;">Disbursement Completed</h2>
    <p style="margin:0 0 16px;">
      Disbursement has been <span style="color:${PCT_ORANGE};font-weight:600;">completed</span> for this order.
    </p>
    ${orderDetailsTable(data)}
    <p>Funds have been disbursed. Please verify receipt and review details in the portal.</p>
    ${portalButton('View Order')}
  `;

  return {
    subject: `Disbursement completed for ${data.fileNumber}`,
    html: emailLayout('Disbursement', body),
  };
}

// ─── Order Confirmation (extracted to confirmation-template.ts) ─────────────
export { orderConfirmationTemplate } from './confirmation-template';
export type { FullConfirmationData as OrderConfirmationData } from './confirmation-template';

// ─── Document Received ──────────────────────────────────────────────────────

export function documentReceivedTemplate(data: DocumentEmailData): EmailTemplate {
  const categoryLabel = data.category.charAt(0).toUpperCase() + data.category.slice(1);

  const body = `
    <h2 style="color:${PCT_NAVY};margin:0 0 8px;font-size:22px;">New Document Available</h2>
    <p style="margin:0 0 16px;">
      A new <span style="color:${PCT_ORANGE};font-weight:600;">${esc(categoryLabel)}</span> document has been added to this order.
    </p>
    ${orderDetailsTable(data)}
    <p>You can view and download the document from the portal.</p>
    ${portalButton('View Documents')}
  `;

  return {
    subject: `New ${categoryLabel.toLowerCase()} document for Order ${data.fileNumber}`,
    html: emailLayout('Document', body),
  };
}
