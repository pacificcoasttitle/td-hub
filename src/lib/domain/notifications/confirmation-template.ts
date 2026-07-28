import {
  BORDER_SOFT,
  CARD_BG,
  ORANGE_TINT,
  PCT_NAVY,
  PCT_ORANGE,
  TEXT_MUTED,
  TEXT_PRIMARY,
  detailsRow as row,
  emailLayout as layout,
  esc,
} from './email-layout';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hub.pctitle.com';
const FINCEN_URL = process.env.FINCEN_CHECK_URL ?? 'https://hub.pctitle.com/fincen-check';

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
  property?: { address?: string | null; city?: string | null; zip?: string | null; county?: string | null; apn?: string | null; legalDescription?: string | null } | null;
  taxData?: ConfirmationTaxData | null;
  seller?: { primary?: string | null; secondary?: string | null } | null;
  parties?: { buyerAgent?: ConfirmationParty | null; listingAgent?: ConfirmationParty | null; lender?: ConfirmationParty | null; escrow?: ConfirmationParty | null } | null;
  assignments?: { salesRep?: string | null; titleOfficer?: string | null } | null;
  hasDocuments: boolean;
  /** Labels for PDFs actually attached (attach-what-exists). Empty = no doc note. */
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

export function moneyRowForTransaction(
  transactionType: string | null | undefined,
  salesPrice: string | null | undefined,
  loanAmount: string | null | undefined,
): string {
  const t = transactionType?.toLowerCase().trim() ?? '';
  if (t === 'purchase') {
    return isMeaningfulMoney(salesPrice) ? row('Sales Price', salesPrice!) : '';
  }
  if (t === 'refinance') {
    return isMeaningfulMoney(loanAmount) ? row('Loan Amount', loanAmount!) : '';
  }
  // Other / unknown types: hide the money row (never render Sales Price: 0).
  return '';
}

function detailsTable(rows: string): string {
  if (!rows) return '';
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BG};border-radius:10px;margin:0 0 20px;border:1px solid ${BORDER_SOFT};">${rows}</table>`;
}

function sectionHeading(title: string): string {
  return `<p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${PCT_NAVY};letter-spacing:0.02em;">${esc(title)}</p>`;
}

function partyBlock(label: string, p: ConfirmationParty | null | undefined): string {
  if (!p || (!p.name && !p.email)) return '';
  let rows = '';
  if (p.name) rows += row('Name', p.name);
  if (p.email) rows += row('Email', p.email);
  if (p.phone) rows += row('Telephone', p.phone);
  if (p.company) rows += row('Company', p.company);
  return `${sectionHeading(label)}${detailsTable(rows)}`;
}

/** Same pill chrome as attached Legal Vesting / Tax / Grant Deed chips. */
function pill(label: string, href?: string): string {
  const inner = `<span style="color:${PCT_ORANGE};font-size:15px;margin-right:8px;">▣</span>${esc(label)}`;
  const content = href
    ? `<a href="${href}" style="color:${TEXT_PRIMARY};text-decoration:none;font-size:13px;font-weight:700;display:inline-block;">${inner}</a>`
    : `<span style="color:${TEXT_PRIMARY};font-size:13px;font-weight:700;">${inner}</span>`;
  return `<div style="display:inline-block;border:1px solid ${BORDER_SOFT};border-radius:999px;padding:9px 14px;background:#FFFFFF;">${content}</div>`;
}

function inlinePills(items: Array<{ label: string; href?: string }>): string {
  if (items.length === 0) return '';
  const cells = items.map((item) =>
    `<td style="padding:0 8px 8px 0;white-space:nowrap;">${pill(item.label, item.href)}</td>`,
  ).join('');
  return `<table cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>${cells}</tr></table>`;
}

function installmentRows(label: string, inst: TaxInstallment | null | undefined): string {
  if (!inst) return '';
  let r = '';
  if (inst.amount) r += row(`${label} Amount`, inst.amount);
  if (inst.balance) r += row(`${label} Balance`, inst.balance);
  if (inst.dueDate) r += row(`${label} Due Date`, inst.dueDate);
  if (inst.status) r += row(`${label} Status`, inst.status);
  return r;
}

function installmentCard(title: string, inst: TaxInstallment | null | undefined): string {
  if (!inst) return '';
  const rows = installmentRows(title, inst);
  if (!rows) return '';
  return `<td width="50%" valign="top" style="padding:0 6px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BG};border:1px solid ${BORDER_SOFT};border-radius:10px;">
      <tr><td style="padding:12px 14px 4px;font-size:12px;font-weight:700;color:${PCT_ORANGE};text-transform:uppercase;letter-spacing:0.04em;">${esc(title)}</td></tr>
      ${rows}
    </table>
  </td>`;
}

function attachedDocsHtml(labels: string[], hasDocuments: boolean, isTitlePointActive: boolean): string {
  if (labels.length > 0 || hasDocuments) {
    const items = labels.length > 0 ? labels : ['Title documents'];
    return `
      ${sectionHeading('Attached documents')}
      <p style="margin:0 0 10px;font-size:13px;color:${TEXT_MUTED};"><strong style="color:${TEXT_PRIMARY};">Attached:</strong> ${esc(items.join(', '))}</p>
      ${inlinePills(items.map((label) => ({ label })))}`;
  }

  if (!isTitlePointActive) {
    return `<div style="background:${ORANGE_TINT};border-left:3px solid ${PCT_ORANGE};padding:14px 16px;margin:0 0 20px;">
      <p style="margin:0;font-size:13px;color:${TEXT_MUTED};">TitlePoint is currently offline. Documents will be available when service resumes.</p>
    </div>`;
  }

  return '';
}

function titleOfficerHtml(to: ConfirmationParty | null | undefined): string {
  if (!to || (!to.name && !to.email && !to.phone)) return '';
  const contactLine = [to.email, to.phone].filter(Boolean).join(' · ');
  return `
    <div style="background:${ORANGE_TINT};border:1px solid ${PCT_ORANGE};border-radius:12px;padding:16px 18px;margin:0 0 20px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:${PCT_ORANGE};text-transform:uppercase;letter-spacing:0.06em;">Your Title Officer</p>
      ${to.name ? `<p style="margin:0 0 4px;font-size:16px;font-weight:700;color:${PCT_NAVY};">${esc(to.name)}</p>` : ''}
      ${contactLine ? `<p style="margin:0;font-size:13px;color:${TEXT_PRIMARY};">${esc(contactLine)}</p>` : ''}
      <p style="margin:8px 0 0;font-size:12px;color:${TEXT_MUTED};">Questions about this order? Contact your title officer above.</p>
    </div>`;
}

export function orderConfirmationTemplate(data: FullConfirmationData): { subject: string; html: string } {
  const isPurchase = data.transactionType?.toLowerCase() === 'purchase';
  const pt = data.productType?.toLowerCase().trim() ?? '';
  const hideGenerateFees = pt === 'full alta' || pt === 'hard money';
  const fn = data.fileNumber;
  const orderUrl = `${APP_URL}/orders/confirm/${encodeURIComponent(fn)}`;

  // FinCEN — purchase only; never show Sales Price: 0
  let fincenHtml = '';
  if (isPurchase) {
    const fincenPrice = isMeaningfulMoney(data.salesPrice) ? data.salesPrice! : 'N/A';
    fincenHtml = `
    <div style="background:${ORANGE_TINT};border:1px solid ${PCT_ORANGE};border-radius:12px;padding:18px;margin:0 0 20px;">
      <p style="color:${PCT_NAVY};margin:0 0 8px;font-size:15px;font-weight:700;">FinCEN Reporting Quick Check</p>
      <p style="margin:0 0 8px;font-size:13px;color:${TEXT_PRIMARY};">Sales Price: <strong>${esc(fincenPrice)}</strong></p>
      <ul style="margin:0 0 14px;padding-left:20px;font-size:13px;color:${TEXT_PRIMARY};">
        <li>Is this an all-cash or wire-financed transaction?</li>
        <li>Is the buyer a legal entity or trust?</li>
      </ul>
      ${inlinePills([{ label: 'Check This Transaction', href: FINCEN_URL }])}
    </div>`;
  }

  const attachedLabels = (data.attachedDocLabels ?? []).filter(Boolean);
  const docHtml = attachedDocsHtml(attachedLabels, data.hasDocuments, data.isTitlePointActive);

  // Action pills — same chrome as doc chips, inline, prominent (near top).
  const actionItems: Array<{ label: string; href: string }> = [];
  if (!hideGenerateFees) {
    actionItems.push({ label: 'Generate Fees', href: `${APP_URL}/orders/${encodeURIComponent(fn)}/fees` });
  }
  actionItems.push({ label: 'Generate Proposed', href: `${APP_URL}/orders/${encodeURIComponent(fn)}/proposed` });
  actionItems.push({ label: 'Generate CPL', href: `${APP_URL}/orders/${encodeURIComponent(fn)}/cpl` });
  actionItems.push({ label: 'View Order in Portal', href: orderUrl });
  const actionPills = `
    ${sectionHeading('Quick actions')}
    ${inlinePills(actionItems)}`;

  // Order / property summary
  let summaryRows = '';
  summaryRows += row('Order #', fn);
  if (data.address) summaryRows += row('Property', data.address);
  if (data.property) {
    const addr = [data.property.address, data.property.city, data.property.zip].filter(Boolean).join(', ');
    if (addr && !data.address) summaryRows += row('Property Address', addr);
    else if (addr && data.address && addr !== data.address) summaryRows += row('Property Address', addr);
    if (data.property.apn) summaryRows += row('APN', data.property.apn);
    if (data.property.county) summaryRows += row('County', data.property.county);
    if (data.property.legalDescription) summaryRows += row('Legal Description', data.property.legalDescription);
  }
  if (data.opener?.name) summaryRows += row('Opened By', data.opener.name);
  if (data.opener?.email) summaryRows += row('Opener Email', data.opener.email);
  if (data.transactionType) summaryRows += row('Transaction Type', data.transactionType);
  summaryRows += moneyRowForTransaction(data.transactionType, data.salesPrice, data.loanAmount);
  const summaryHtml = summaryRows
    ? `${sectionHeading('Order & property summary')}${detailsTable(summaryRows)}`
    : '';

  // Tax section
  let taxHtml = '';
  if (data.taxData) {
    const td = data.taxData;
    let overview = '';
    if (td.taxRateArea) overview += row('Tax Rate Area', td.taxRateArea);
    if (td.useCode) overview += row('Use Code', td.useCode);
    if (td.regionCode) overview += row('Region Code', td.regionCode);
    if (td.floodZone) overview += row('Flood Zone', td.floodZone);
    if (td.zoningCode) overview += row('Zoning Code', td.zoningCode);
    if (td.taxRate) overview += row('Tax Rate', td.taxRate);
    if (td.issueDate) overview += row('Issue Date', td.issueDate);
    if (td.landValue) overview += row('Land Value', td.landValue);
    if (td.improvementsValue) overview += row('Improvements Value', td.improvementsValue);

    const firstCard = installmentCard('1st Installment', td.firstInstallment);
    const secondCard = installmentCard('2nd Installment', td.secondInstallment);
    const installmentTable = (firstCard || secondCard)
      ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>${firstCard}${secondCard || '<td></td>'}</tr></table>`
      : '';

    if (overview || installmentTable) {
      taxHtml = `${sectionHeading('Property Tax Details')}${detailsTable(overview)}${installmentTable}`;
    }
  }

  let sellerHtml = '';
  if (data.seller?.primary) {
    let rows = row('Primary Owner', data.seller.primary);
    if (data.seller.secondary) rows += row('Secondary Owner', data.seller.secondary);
    sellerHtml = `${sectionHeading('Seller / Owner')}${detailsTable(rows)}`;
  }

  // Transaction details — sales/loan already in summary via conditional; avoid duplicate / zero rows here.
  let txHtml = '';
  {
    let rows = '';
    if (data.assignments?.salesRep) rows += row('Sales Rep', data.assignments.salesRep);
    if (data.productType) rows += row('Product', data.productType);
    if (data.loanNumber) rows += row('Loan Number', data.loanNumber);
    if (data.escrowNumber) rows += row('Escrow Number', data.escrowNumber);
    if (rows) txHtml = `${sectionHeading('Transaction details')}${detailsTable(rows)}`;
  }

  const partyHtml = [
    partyBlock('Buyer Agent', data.parties?.buyerAgent),
    partyBlock('Listing Agent', data.parties?.listingAgent),
    partyBlock('Lender', data.parties?.lender),
    partyBlock('Escrow', data.parties?.escrow),
  ].join('');

  const toBlock = titleOfficerHtml(
    data.titleOfficer
      ?? (data.assignments?.titleOfficer
        ? { name: data.assignments.titleOfficer, email: null, phone: null, company: null }
        : null),
  );

  const body = `
    <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:${PCT_NAVY};">Title order opened</p>
    <p style="margin:0 0 6px;font-size:15px;color:${TEXT_PRIMARY};line-height:1.6;">Pacific Coast Title has opened a new order.</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:${PCT_NAVY};">Order # ${esc(fn)}</p>
    ${toBlock}
    ${actionPills}
    ${summaryHtml}
    ${docHtml}
    ${taxHtml}
    ${fincenHtml}
    ${sellerHtml}
    ${txHtml}
    ${partyHtml}`;

  return {
    subject: `Open Order Confirmation - ${fn}`,
    html: layout('Order Confirmation', body),
  };
}
