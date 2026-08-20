import {
  HERO_BG,
  ORANGE_SOFT,
  ORANGE_TINT,
  PCT_DEEP,
  PCT_ORANGE,
  TEXT_PRIMARY,
  emailShell,
  esc,
  fieldTable,
  detailsRow as row,
} from './email-layout';
import {
  isMeaningfulMoney,
  isPurchaseTransaction,
  isRefinanceTransaction,
} from '@/lib/domain/orders/order-format';

const DASH = '—';

export interface ConfirmationParty {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
}

export interface TaxInstallment {
  balance?: string | null;
  amount?: string | null;
  dueDate?: string | null;
  status?: string | null;
  number?: string | null;
  paymentDate?: string | null;
  penalty?: string | null;
  amountPaid?: string | null;
  taxYear?: string | null;
  [key: string]: unknown;
}

export interface ConfirmationTaxData {
  taxRateArea?: string | null;
  useCode?: string | null;
  regionCode?: string | null;
  floodZone?: string | null;
  zoningCode?: string | null;
  taxabilityCode?: string | null;
  taxRate?: string | null;
  issueDate?: string | null;
  landValue?: string | null;
  improvementsValue?: string | null;
  firstInstallment?: TaxInstallment | null;
  secondInstallment?: TaxInstallment | null;
}

export interface FullConfirmationData {
  fileNumber: string;
  openedAt?: Date | string | null;
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

// isMeaningfulMoney and the transaction-type predicates moved to
// domain/orders/order-format so the order overview can share them without
// pulling this email template into the client bundle. Re-exported here so
// existing importers of isMeaningfulMoney keep working unchanged.
export { isMeaningfulMoney };

export function moneyForTransaction(
  transactionType: string | null | undefined,
  salesPrice: string | null | undefined,
  loanAmount: string | null | undefined,
): { label: string; value: string } | null {
  if (isPurchaseTransaction(transactionType)) {
    return isMeaningfulMoney(salesPrice) ? { label: 'Sales price', value: salesPrice! } : null;
  }
  if (isRefinanceTransaction(transactionType)) {
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

function openedByHtml(opener: ConfirmationParty | null | undefined): string {
  if (!opener?.name && !opener?.email) return esc(DASH);
  const name = opener.name?.trim() || DASH;
  if (opener.email?.trim()) {
    const email = opener.email.trim();
    return `${esc(name)} &middot; <a href="mailto:${esc(email)}" style="color:${PCT_ORANGE};text-decoration:none;">${esc(email)}</a>`;
  }
  return esc(name);
}

function titleOfficerName(
  to: ConfirmationParty | null | undefined,
  fallbackName?: string | null,
): string {
  return to?.name?.trim() || fallbackName?.trim() || DASH;
}

function formatDueDate(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return DASH;
  const parsed = Date.parse(raw.includes('T') ? raw : `${raw}T12:00:00Z`);
  if (Number.isNaN(parsed)) return raw;
  return new Date(parsed).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function installmentCard(
  title: string,
  inst: TaxInstallment | null | undefined,
  side: 'left' | 'right',
  bg: string,
): string {
  const pad = side === 'left' ? 'padding-right:7px;' : 'padding-left:7px;';
  const amount = display(inst?.amount);
  const due = formatDueDate(inst?.dueDate);
  const status = display(inst?.status);
  const lines = [
    `Balance: ${display(inst?.balance)}`,
    `Due: ${due}`,
    inst?.paymentDate ? `Paid: ${formatDueDate(inst.paymentDate)}` : null,
    inst?.penalty ? `Penalty: ${inst.penalty}` : null,
    inst?.amountPaid ? `Amount paid: ${inst.amountPaid}` : null,
  ].filter(Boolean).map((line) => `<p style="margin:0 0 6px;color:#D8DEE8;font-size:12px;line-height:1.5;">${esc(String(line))}</p>`).join('');
  const footer = [status, inst?.taxYear ? `TAX YEAR ${inst.taxYear}` : null].filter(Boolean).join(' &nbsp;&middot;&nbsp; ');
  return `<td width="50%" valign="top" style="${pad}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${bg};border-radius:12px;"><tr><td style="padding:20px;color:#ffffff;"><p style="margin:0 0 14px;color:${ORANGE_SOFT};font-size:11px;font-weight:bold;letter-spacing:.8px;">${title}</p><p style="margin:0 0 12px;font-size:24px;font-weight:bold;">${esc(amount)}</p>${lines}<p style="margin:12px 0 0;color:#ffffff;font-size:11px;font-weight:bold;">${esc(footer)}</p></td></tr></table></td>`;
}

export function orderConfirmationTemplate(data: FullConfirmationData): { subject: string; html: string } {
  const fn = data.fileNumber;
  const money = moneyForTransaction(data.transactionType, data.salesPrice, data.loanAmount);
  const tax = data.taxData;
  const address = propertyAddress(data);
  const county = data.property?.county?.trim();

  const titleOfficer = data.titleOfficer
    ?? (data.assignments?.titleOfficer
      ? { name: data.assignments.titleOfficer, email: null, phone: null, company: null }
      : null);

  const heading = (s: string) => `<p style="margin:30px 0 12px;color:${TEXT_PRIMARY};font-size:19px;font-weight:bold;">${esc(s)}</p>`;
  const mail = (v?: string | null) => v?.trim() ? `<a href="mailto:${esc(v.trim())}" style="color:${PCT_ORANGE};text-decoration:none;">${esc(v.trim())}</a>` : esc(DASH);
  const tel = (v?: string | null) => v?.trim() ? `<a href="tel:${esc(v.replace(/[^\d+]/g, ''))}" style="color:${PCT_ORANGE};text-decoration:none;">${esc(v.trim())}</a>` : esc(DASH);
  const openedAt = data.openedAt ? new Date(data.openedAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) : DASH;
  const orderRows = [
    { label: 'Opened by', valueHtml: esc(display(data.opener?.name)) },
    { label: 'Open email', valueHtml: mail(data.opener?.email) },
    { label: 'Open telephone', valueHtml: tel(data.opener?.phone) },
    { label: 'Company', valueHtml: esc(display(data.opener?.company)) },
    { label: 'Address', valueHtml: esc(display(data.opener?.address)) },
    { label: 'City', valueHtml: esc(display(data.opener?.city)) },
    { label: 'ZIP', valueHtml: esc(display(data.opener?.zip)) },
    { label: 'Opened at', valueHtml: esc(openedAt) },
  ];
  const propertyRows = [
    { label: 'Property address', valueHtml: esc(display(data.property?.address)) },
    { label: 'Full street address', valueHtml: esc(address) },
    { label: 'APN', valueHtml: esc(display(data.property?.apn)) },
    { label: 'County', valueHtml: esc(display(county)) },
    { label: 'Legal description', valueHtml: esc(display(data.property?.legalDescription)) },
  ];
  const taxRows = tax ? [
    ['Tax rate area', tax.taxRateArea], ['Use code', tax.useCode], ['Region code', tax.regionCode],
    ['Flood zone', tax.floodZone], ['Zoning code', tax.zoningCode], ['Taxability code', tax.taxabilityCode],
    ['Tax rate', tax.taxRate], ['Issue date', tax.issueDate], ['Land', tax.landValue], ['Improvements', tax.improvementsValue],
  ].map(([label, value]) => ({ label: label!, valueHtml: esc(display(value)) })) : [];
  const transactionRows = [
    { label: 'Sales rep', valueHtml: esc(display(data.assignments?.salesRep)) },
    { label: 'Title officer', valueHtml: esc(titleOfficerName(titleOfficer, data.assignments?.titleOfficer)) },
    { label: 'Product', valueHtml: esc(display(data.productType)) },
    { label: 'Loan number', valueHtml: esc(display(data.loanNumber)) },
  ];
  if (money) transactionRows.push({ label: money.label, valueHtml: esc(money.value) });
  const escrow = data.parties?.escrow;

  const hasInstallments = Boolean(tax?.firstInstallment || tax?.secondInstallment);
  const installmentsHtml = hasInstallments
    ? `${heading('Tax installments')}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${installmentCard('1ST INSTALLMENT', tax?.firstInstallment, 'left', PCT_DEEP)}${installmentCard('2ND INSTALLMENT', tax?.secondInstallment, 'right', HERO_BG)}</tr></table>`
    : '';

  const bodyHtml = `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${ORANGE_TINT};border-radius:14px;"><tr><td style="padding:22px 22px 20px;">
<span style="display:inline-block;background:#E8F5EF;color:#176B4D;font-size:11px;line-height:1;font-weight:bold;letter-spacing:.6px;padding:8px 11px;border-radius:999px;">ORDER OPENED SUCCESSFULLY</span>
<p style="margin:16px 0 4px;color:${TEXT_PRIMARY};font-size:20px;line-height:1.3;font-weight:bold;">${esc(address)}</p>
<p style="margin:0;color:#4B5563;font-size:13px;">${esc([data.property?.city, data.property?.zip].filter(Boolean).join(', ') || DASH)}${county ? ` &nbsp;&middot;&nbsp; ${esc(county)} County` : ''}</p>
</td></tr></table>
<p style="margin:30px 0 4px;color:${PCT_ORANGE};font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;">Order summary</p>
<h2 style="margin:0 0 12px;color:${TEXT_PRIMARY};font-size:19px;">Your order details are below</h2>
${fieldTable(orderRows)}
${heading('Property details')}${fieldTable(propertyRows)}
${taxRows.length ? `${heading('Property tax details')}${fieldTable(taxRows)}` : ''}
${installmentsHtml}
${heading('Seller / owner details')}${fieldTable([{ label: 'Primary owner', valueHtml: esc(display(data.seller?.primary)) }, { label: 'Secondary owner', valueHtml: esc(display(data.seller?.secondary)) }])}
${heading('Transaction details')}${fieldTable(transactionRows)}
${heading('Escrow details')}${fieldTable([{ label: 'Name', valueHtml: esc(display(escrow?.name)) }, { label: 'Email address', valueHtml: mail(escrow?.email) }, { label: 'Telephone', valueHtml: tel(escrow?.phone) }, { label: 'Company', valueHtml: esc(display(escrow?.company)) }])}`;

  const subject = `Open Order Confirmation - ${fn}`;
  return {
    subject,
    html: emailShell({
      title: subject,
      badge: 'Order confirmation',
      preheader: 'We have opened the order and prepared the initial property information.',
      hero: {
        icon: '✓',
        eyebrow: 'Order received',
        headline: 'Your title order is open.',
        subcopy: 'We have opened the order and prepared the initial property information.',
      },
      tracker: { stage: 1, fileNumber: fn, address },
      bodyHtml,
    }),
  };
}
