import { detailsRow as row, esc } from './email-layout';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://hub.pctitle.com').replace(/\/+$/, '');
const LOGO_URL = 'https://www.pct.com/logo2.png';
const DASH = '—';

export interface ConfirmationParty {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
}

export interface TaxInstallment {
  balance?: string | null;
  amount?: string | null;
  dueDate?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface ConfirmationTaxData {
  taxRateArea?: string | null;
  useCode?: string | null;
  regionCode?: string | null;
  floodZone?: string | null;
  zoningCode?: string | null;
  taxRate?: string | null;
  issueDate?: string | null;
  landValue?: string | null;
  improvementsValue?: string | null;
  firstInstallment?: TaxInstallment | null;
  secondInstallment?: TaxInstallment | null;
}

export interface FullConfirmationData {
  fileNumber: string;
  address?: string | null;
  transactionType?: string | null;
  productType?: string | null;
  salesPrice?: string | null;
  loanAmount?: string | null;
  loanNumber?: string | null;
  escrowNumber?: string | null;
  opener?: ConfirmationParty | null;
  /** Title officer contact for the client (name + email/phone). */
  titleOfficer?: ConfirmationParty | null;
  property?: {
    address?: string | null;
    city?: string | null;
    zip?: string | null;
    county?: string | null;
    apn?: string | null;
    legalDescription?: string | null;
  } | null;
  taxData?: ConfirmationTaxData | null;
  seller?: { primary?: string | null; secondary?: string | null } | null;
  parties?: {
    buyerAgent?: ConfirmationParty | null;
    listingAgent?: ConfirmationParty | null;
    lender?: ConfirmationParty | null;
    escrow?: ConfirmationParty | null;
  } | null;
  assignments?: { salesRep?: string | null; titleOfficer?: string | null } | null;
  hasDocuments: boolean;
  /** Labels for PDFs actually attached (attach-what-exists). Empty = no doc pills. */
  attachedDocLabels?: string[];
  isTitlePointActive: boolean;
}

/** True for a displayable money string that is not empty/dash/zero. */
export function isMeaningfulMoney(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed.toLowerCase() === 'n/a') return false;
  const normalized = trimmed.replace(/[$,\s]/g, '');
  if (!normalized) return false;
  const n = Number(normalized);
  if (Number.isFinite(n) && n === 0) return false;
  return true;
}

export function moneyForTransaction(
  transactionType: string | null | undefined,
  salesPrice: string | null | undefined,
  loanAmount: string | null | undefined,
): { label: string; value: string } | null {
  const t = transactionType?.toLowerCase().trim() ?? '';
  if (t === 'purchase') {
    return isMeaningfulMoney(salesPrice) ? { label: 'Sales price', value: salesPrice! } : null;
  }
  if (t === 'refinance') {
    return isMeaningfulMoney(loanAmount) ? { label: 'Loan amount', value: loanAmount! } : null;
  }
  return null;
}

/** Test helper — keeps polish unit tests on money conditional. */
export function moneyRowForTransaction(
  transactionType: string | null | undefined,
  salesPrice: string | null | undefined,
  loanAmount: string | null | undefined,
): string {
  const m = moneyForTransaction(transactionType, salesPrice, loanAmount);
  if (!m) return '';
  // Normalize labels to historical polish expectations (Sales Price / Loan Amount).
  const label = m.label === 'Sales price' ? 'Sales Price' : m.label === 'Loan amount' ? 'Loan Amount' : m.label;
  return row(label, m.value);
}

function display(value: string | null | undefined): string {
  const v = value?.trim();
  return v ? v : DASH;
}

function propertyAddress(data: FullConfirmationData): string {
  if (data.address?.trim()) return data.address.trim();
  if (!data.property) return DASH;
  const composed = [data.property.address, data.property.city, data.property.zip].filter(Boolean).join(', ');
  return composed || DASH;
}

/** Map attach-what-exists labels → template pill labels (display only, not links). */
const DOC_PILL_ORDER: Array<{ match: RegExp; label: string }> = [
  { match: /legal/i, label: 'Legal &amp; Vesting' },
  { match: /tax/i, label: 'Tax Roll' },
  { match: /grant/i, label: 'Recent Grant Deed' },
];

function docPillsHtml(labels: string[]): string {
  const present = DOC_PILL_ORDER.filter((d) => labels.some((l) => d.match.test(l)));
  if (present.length === 0) return '';

  const cells = present.map((d, i) => {
    const isLast = i === present.length - 1;
    const pad = isLast ? 'padding:0 0 8px 0;' : 'padding:0 8px 8px 0;';
    // Pills are visual labels only — PDFs are email attachments (not hrefs).
    return `<td style="${pad}"><span style="display:block;background:#DCEFF0;color:#10213A;font-size:13px;font-weight:bold;padding:12px 14px;border-radius:10px;">${d.label}</span></td>`;
  }).join('');

  return `<tr><td style="padding:0 32px 28px 32px;"><h2 style="margin:0 0 14px 0;color:#10213A;font-size:18px;">Initial documents</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${cells}</tr></table></td></tr>`;
}

function snapshotRow(
  label: string,
  valueHtml: string,
  opts?: { last?: boolean },
): string {
  const border = opts?.last ? '' : 'border-bottom:1px solid #E5E7EB;';
  return `<tr><td width="36%" style="background:#F8FAFC;color:#6B7280;font-size:13px;padding:13px 16px;${border}">${label}</td><td style="color:#10213A;font-size:14px;font-weight:bold;padding:13px 16px;${border}">${valueHtml}</td></tr>`;
}

function openedByHtml(opener: ConfirmationParty | null | undefined): string {
  if (!opener?.name && !opener?.email) return esc(DASH);
  const name = opener.name?.trim() || DASH;
  if (opener.email?.trim()) {
    const email = opener.email.trim();
    return `${esc(name)} · <a href="mailto:${esc(email)}" style="color:#F26B2B;text-decoration:none;">${esc(email)}</a>`;
  }
  return esc(name);
}

function titleOfficerHtml(to: ConfirmationParty | null | undefined, fallbackName?: string | null): string {
  const name = to?.name?.trim() || fallbackName?.trim() || '';
  const contact = [to?.email?.trim(), to?.phone?.trim()].filter(Boolean);
  if (!name && contact.length === 0) return esc(DASH);
  if (!name) return esc(contact.join(' · '));
  if (contact.length === 0) return esc(name);
  const email = to?.email?.trim();
  if (email) {
    const rest = to?.phone?.trim() ? ` · ${esc(to.phone!.trim())}` : '';
    return `${esc(name)} · <a href="mailto:${esc(email)}" style="color:#F26B2B;text-decoration:none;">${esc(email)}</a>${rest}`;
  }
  return esc([name, ...contact].join(' · '));
}

function installmentCard(
  title: string,
  inst: TaxInstallment | null | undefined,
  sidePad: 'right' | 'left',
): string {
  const pad = sidePad === 'right' ? 'padding-right:8px;' : 'padding-left:8px;';
  const amount = display(inst?.amount);
  const due = display(inst?.dueDate);
  const status = display(inst?.status);
  return `<td width="50%" valign="top" style="${pad}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E5E7EB;border-radius:12px;"><tr><td style="padding:16px;"><div style="font-size:12px;font-weight:bold;color:#F26B2B;letter-spacing:.6px;margin-bottom:10px;">${title}</div><div style="font-size:13px;color:#6B7280;">Amount</div><div style="font-size:17px;font-weight:bold;color:#10213A;margin:2px 0 10px 0;">${esc(amount)}</div><div style="font-size:13px;color:#6B7280;">Due ${esc(due)}</div><div style="margin-top:10px;display:inline-block;background:#E8F5EF;color:#176B4D;font-size:11px;font-weight:bold;padding:6px 9px;border-radius:999px;">${esc(status)}</div></td></tr></table></td>`;
}

export function orderConfirmationTemplate(data: FullConfirmationData): { subject: string; html: string } {
  const fn = data.fileNumber;
  const orderUrl = `${APP_URL}/orders/confirm/${encodeURIComponent(fn)}`;
  const pt = data.productType?.toLowerCase().trim() ?? '';
  const hideGenerateFees = pt === 'full alta' || pt === 'hard money';

  const feesUrl = `${APP_URL}/orders/${encodeURIComponent(fn)}/fees`;
  const proposedUrl = `${APP_URL}/orders/${encodeURIComponent(fn)}/proposed`;
  const cplUrl = `${APP_URL}/orders/${encodeURIComponent(fn)}/cpl`;

  const money = moneyForTransaction(data.transactionType, data.salesPrice, data.loanAmount);
  const tax = data.taxData;
  const attachedLabels = (data.attachedDocLabels ?? []).filter(Boolean);

  const titleOfficer = data.titleOfficer
    ?? (data.assignments?.titleOfficer
      ? { name: data.assignments.titleOfficer, email: null, phone: null, company: null }
      : null);

  // Quick actions — template colors: Fees #10213A / Proposed #0E5A63 / CPL #F26B2B
  const actionCells: string[] = [];
  if (!hideGenerateFees) {
    actionCells.push(`<td style="padding-right:8px;"><a href="${feesUrl}" style="display:block;text-align:center;background:#10213A;color:#ffffff;text-decoration:none;font-size:13px;font-weight:bold;padding:12px 10px;border-radius:8px;">Generate Fees</a></td>`);
  }
  actionCells.push(`<td style="padding:0 4px;"><a href="${proposedUrl}" style="display:block;text-align:center;background:#0E5A63;color:#ffffff;text-decoration:none;font-size:13px;font-weight:bold;padding:12px 10px;border-radius:8px;">Generate Proposed</a></td>`);
  actionCells.push(`<td style="padding-left:8px;"><a href="${cplUrl}" style="display:block;text-align:center;background:#F26B2B;color:#ffffff;text-decoration:none;font-size:13px;font-weight:bold;padding:12px 10px;border-radius:8px;">Generate CPL</a></td>`);

  const moneyRow = money
    ? `<tr><td style="padding:14px 16px;"><div style="font-size:12px;color:#6B7280;">${esc(money.label)}</div><div style="font-size:14px;font-weight:bold;color:#10213A;margin-top:3px;">${esc(money.value)}</div></td></tr>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Open Order Confirmation</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(16,33,58,.08);">
<tr><td style="background:#10213A;padding:26px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td valign="middle"><img src="${LOGO_URL}" width="155" alt="Pacific Coast Title" style="display:block;border:0;max-width:155px;height:auto;"></td><td align="right" valign="middle" style="font-size:12px;font-weight:bold;letter-spacing:1.2px;color:#FF8A4C;">ORDER CONFIRMATION</td></tr></table></td></tr>
<tr><td style="padding:34px 32px 26px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FAF7F1;border:1px solid #E5E7EB;border-radius:14px;"><tr><td style="padding:24px 24px 22px 24px;"><div style="display:inline-block;background:#E8F5EF;color:#176B4D;font-size:12px;font-weight:bold;letter-spacing:.6px;padding:7px 11px;border-radius:999px;margin-bottom:14px;">ORDER OPENED SUCCESSFULLY</div><h1 style="margin:0 0 8px 0;color:#10213A;font-size:28px;line-height:1.2;">Your title order is open</h1><p style="margin:0 0 18px 0;color:#4B5563;font-size:15px;line-height:1.6;">Pacific Coast Title has opened your order and prepared the initial property documents.</p><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:#F26B2B;border-radius:8px;"><a href="${orderUrl}" target="_blank" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 18px;">View Order in Portal</a></td></tr></table></td></tr></table></td></tr>
<tr><td style="padding:0 32px 28px 32px;"><h2 style="margin:0 0 14px 0;color:#10213A;font-size:18px;">Order snapshot</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
${snapshotRow('Order number', esc(fn))}
${snapshotRow('Property', esc(propertyAddress(data)))}
${snapshotRow('APN', esc(display(data.property?.apn)))}
${snapshotRow('County', esc(display(data.property?.county)))}
${snapshotRow('Transaction type', esc(display(data.transactionType)))}
${snapshotRow('Opened by', openedByHtml(data.opener))}
${snapshotRow('Title officer', titleOfficerHtml(titleOfficer, data.assignments?.titleOfficer), { last: true })}
</table></td></tr>
${docPillsHtml(attachedLabels)}
<tr><td style="padding:0 32px 28px 32px;"><h2 style="margin:0 0 14px 0;color:#10213A;font-size:18px;">Property tax summary</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;"><tr><td width="50%" style="padding:15px 16px;border-bottom:1px solid #E5E7EB;border-right:1px solid #E5E7EB;"><div style="font-size:12px;color:#6B7280;margin-bottom:4px;">Tax rate</div><div style="font-size:15px;color:#10213A;font-weight:bold;">${esc(display(tax?.taxRate))}</div></td><td width="50%" style="padding:15px 16px;border-bottom:1px solid #E5E7EB;"><div style="font-size:12px;color:#6B7280;margin-bottom:4px;">Issue date</div><div style="font-size:15px;color:#10213A;font-weight:bold;">${esc(display(tax?.issueDate))}</div></td></tr><tr><td style="padding:15px 16px;border-right:1px solid #E5E7EB;"><div style="font-size:12px;color:#6B7280;margin-bottom:4px;">Land value</div><div style="font-size:15px;color:#10213A;font-weight:bold;">${esc(display(tax?.landValue))}</div></td><td style="padding:15px 16px;"><div style="font-size:12px;color:#6B7280;margin-bottom:4px;">Improvement value</div><div style="font-size:15px;color:#10213A;font-weight:bold;">${esc(display(tax?.improvementsValue))}</div></td></tr></table></td></tr>
<tr><td style="padding:0 32px 28px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${installmentCard('1ST INSTALLMENT', tax?.firstInstallment, 'right')}${installmentCard('2ND INSTALLMENT', tax?.secondInstallment, 'left')}</tr></table></td></tr>
<tr><td style="padding:0 32px 28px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="50%" valign="top" style="padding-right:8px;"><h2 style="margin:0 0 12px 0;color:#10213A;font-size:18px;">Seller / owner</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FAF7F1;border-radius:12px;"><tr><td style="padding:14px 16px;border-bottom:1px solid #E5E7EB;"><div style="font-size:12px;color:#6B7280;">Primary owner</div><div style="font-size:14px;font-weight:bold;color:#10213A;margin-top:3px;">${esc(display(data.seller?.primary))}</div></td></tr><tr><td style="padding:14px 16px;"><div style="font-size:12px;color:#6B7280;">Secondary owner</div><div style="font-size:14px;font-weight:bold;color:#10213A;margin-top:3px;">${esc(display(data.seller?.secondary))}</div></td></tr></table></td><td width="50%" valign="top" style="padding-left:8px;"><h2 style="margin:0 0 12px 0;color:#10213A;font-size:18px;">Transaction</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FAF7F1;border-radius:12px;"><tr><td style="padding:14px 16px;${moneyRow ? 'border-bottom:1px solid #E5E7EB;' : ''}"><div style="font-size:12px;color:#6B7280;">Product</div><div style="font-size:14px;font-weight:bold;color:#10213A;margin-top:3px;">${esc(display(data.productType))}</div></td></tr>${moneyRow}</table></td></tr></table></td></tr>
<tr><td style="padding:0 32px 32px 32px;"><h2 style="margin:0 0 14px 0;color:#10213A;font-size:18px;">Quick actions</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${actionCells.join('')}</tr></table></td></tr>
<tr><td style="background:#10213A;padding:22px 32px;text-align:center;"><p style="margin:0 0 6px 0;color:#ffffff;font-size:13px;font-weight:bold;">Pacific Coast Title Company</p><p style="margin:0;color:#D8DEE8;font-size:11px;line-height:1.5;">Automated order confirmation · <a href="https://www.pct.com" style="color:#FF8A4C;text-decoration:none;">pct.com</a></p></td></tr>
</table></td></tr></table>
</body></html>`;

  return {
    subject: `Open Order Confirmation - ${fn}`,
    html,
  };
}
