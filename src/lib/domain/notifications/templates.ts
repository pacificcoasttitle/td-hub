import {
  APP_BASE_URL,
  TEXT_PRIMARY,
  calloutBar,
  ctaButton,
  emailShell,
  esc,
  fieldTable,
  sectionLabel,
} from './email-layout';

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

function orderFields(data: OrderEmailData) {
  const rows = [
    { label: 'File number', valueHtml: esc(data.fileNumber) },
  ];
  if (data.address?.trim()) {
    rows.push({ label: 'Property', valueHtml: esc(data.address.trim()) });
  }
  if (data.closingDate?.trim()) {
    rows.push({ label: 'Date', valueHtml: esc(data.closingDate.trim()) });
  }
  return fieldTable(rows);
}

function orderBody(intro: string, data: OrderEmailData, ctaLabel: string): string {
  return `${intro}
${sectionLabel('Order details')}
${orderFields(data)}
${calloutBar('Open TD Hub for the latest documents, status, and order activity.')}
<div style="height:22px;line-height:22px;">&nbsp;</div>${ctaButton(ctaLabel, `${APP_BASE_URL}/orders`)}`;
}

export function orderClosedTemplate(data: OrderEmailData): EmailTemplate {
  const subject = `Your Order ${data.fileNumber} has been closed`;
  return {
    subject,
    html: emailShell({
      title: subject,
      badge: 'Order closed',
      preheader: 'The transaction has reached its final milestone.',
      hero: {
        icon: '✓',
        eyebrow: 'Transaction complete',
        headline: 'Your order is closed.',
        subcopy: 'The transaction has reached its final milestone.',
      },
      tracker: { stage: 4, fileNumber: data.fileNumber, address: data.address },
      bodyHtml: orderBody(
        '<p style="margin:0 0 22px;">All parties have been notified. Final documents and the completed order record are available in TD Hub.</p>',
        data,
        'View Order Details',
      ),
    }),
  };
}

export function milestoneRecordingTemplate(data: OrderEmailData): EmailTemplate {
  const subject = `Recording confirmed for ${data.fileNumber}${data.address ? ` at ${data.address}` : ''}`;
  return {
    subject,
    html: emailShell({
      title: subject,
      badge: 'Recording',
      preheader: 'The recording confirmation has been received for this order.',
      hero: {
        icon: '✓',
        eyebrow: 'Recording confirmation',
        headline: 'Your transaction has reached the recorder.',
        subcopy: 'Recording is confirmed. The final milestone is disbursement.',
      },
      tracker: { stage: 3, fileNumber: data.fileNumber, address: data.address },
      bodyHtml: orderBody(
        '<p style="margin:0 0 22px;">The order is progressing and the recording milestone is now reflected in TD Hub.</p>',
        data,
        'View Order',
      ),
    }),
  };
}

export function milestoneDisbursementTemplate(data: OrderEmailData): EmailTemplate {
  const subject = `Disbursement completed for ${data.fileNumber}`;
  return {
    subject,
    html: emailShell({
      title: subject,
      badge: 'Disbursement',
      preheader: 'Disbursement is complete for this order.',
      hero: {
        icon: '$',
        eyebrow: 'Milestone reached',
        headline: 'Funds have been disbursed.',
        subcopy: 'Disbursement is complete for this order.',
      },
      tracker: { stage: 4, fileNumber: data.fileNumber, address: data.address },
      bodyHtml: orderBody(
        '<p style="margin:0 0 22px;">Please verify receipt as appropriate and review the transaction details in TD Hub.</p>',
        data,
        'View Order',
      ),
    }),
  };
}

export { orderConfirmationTemplate } from './confirmation-template';
export type { FullConfirmationData as OrderConfirmationData } from './confirmation-template';

function documentCopy(category: string): {
  badge: string;
  headline: string;
  subcopy: string;
  intro: string;
  icon: string;
} {
  const normalized = category.trim().toLowerCase();
  if (normalized === 'prelim') {
    return {
      badge: 'Document',
      icon: 'P',
      headline: 'A new prelim is ready.',
      subcopy: 'The preliminary title document has been added to this order.',
      intro: 'You can review and download the new prelim from TD Hub.',
    };
  }
  if (normalized === 'policy' || normalized === 'supplement') {
    return {
      badge: 'Document',
      icon: 'P',
      headline: 'A new policy is ready.',
      subcopy: 'The policy document has been added to this order.',
      intro: 'You can review and download the new policy from TD Hub.',
    };
  }
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  return {
    badge: 'Document',
    icon: 'P',
    headline: `A new ${label.toLowerCase()} is ready.`,
    subcopy: `A new ${label.toLowerCase()} document has been added to this order.`,
    intro: 'You can view and download the document from TD Hub.',
  };
}

export function documentReceivedTemplate(data: DocumentEmailData): EmailTemplate {
  const categoryLabel = data.category.charAt(0).toUpperCase() + data.category.slice(1);
  const copy = documentCopy(data.category);
  const subject = `New ${categoryLabel.toLowerCase()} document for Order ${data.fileNumber}`;

  return {
    subject,
    html: emailShell({
      title: subject,
      badge: copy.badge,
      preheader: copy.subcopy,
      hero: {
        icon: copy.icon,
        eyebrow: 'Document available',
        headline: copy.headline,
        subcopy: copy.subcopy,
      },
      tracker: data.category.trim().toLowerCase() === 'prelim'
        ? { stage: 2, fileNumber: data.fileNumber, address: data.address }
        : undefined,
      bodyHtml: orderBody(
        `<p style="margin:0 0 22px;">${esc(copy.intro)}</p>`,
        data,
        'View Documents',
      ),
    }),
  };
}
