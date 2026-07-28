import {
  BORDER_SOFT,
  CARD_BG,
  ORANGE_TINT,
  PCT_NAVY,
  PCT_ORANGE,
  TEXT_MUTED,
  TEXT_PRIMARY,
  button as btn,
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

/** OC-3 content labels preserved — presentational layout only. */
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
    const chips = items.map((label) => `
      <tr><td style="padding:0 0 8px;">
        <div style="display:inline-block;border:1px solid ${BORDER_SOFT};border-radius:999px;padding:9px 14px;background:#FFFFFF;color:${TEXT_PRIMARY};font-size:13px;font-weight:700;">
          <span style="color:${PCT_ORANGE};font-size:15px;margin-right:8px;">▣</span>${esc(label)}
        </div>
      </td></tr>`).join('');

    return `
      ${sectionHeading('Attached documents')}
      <p style="margin:0 0 10px;font-size:13px;color:${TEXT_MUTED};"><strong style="color:${TEXT_PRIMARY};">Attached:</strong> ${esc(items.join(', '))}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${chips}</table>`;
  }

  if (!isTitlePointActive) {
    return `<div style="background:${ORANGE_TINT};border-left:3px solid ${PCT_ORANGE};padding:14px 16px;margin:0 0 20px;">
      <p style="margin:0;font-size:13px;color:${TEXT_MUTED};">TitlePoint is currently offline. Documents will be available when service resumes.</p>
    </div>`;
  }

  // OC-3: no "coming shortly" placeholder when TP is active and nothing attached.
  return '';
}

export function orderConfirmationTemplate(data: FullConfirmationData): { subject: string; html: string } {
  const isPurchase = data.transactionType?.toLowerCase() === 'purchase';
  const pt = data.productType?.toLowerCase().trim() ?? '';
  const hideGenerateFees = pt === 'full alta' || pt === 'hard money';
  const fn = data.fileNumber;
  const orderUrl = `${APP_URL}/orders/confirm/${encodeURIComponent(fn)}`;

  // FinCEN block
  let fincenHtml = '';
  if (isPurchase) {
    fincenHtml = `
    <div style="background:${ORANGE_TINT};border:1px solid ${PCT_ORANGE};border-radius:12px;padding:18px;margin:0 0 20px;">
      <p style="color:${PCT_NAVY};margin:0 0 8px;font-size:15px;font-weight:700;">FinCEN Reporting Quick Check</p>
      <p style="margin:0 0 8px;font-size:13px;color:${TEXT_PRIMARY};">Sales Price: <strong>${esc(data.salesPrice ?? 'N/A')}</strong></p>
      <ul style="margin:0 0 14px;padding-left:20px;font-size:13px;color:${TEXT_PRIMARY};">
        <li>Is this an all-cash or wire-financed transaction?</li>
        <li>Is the buyer a legal entity or trust?</li>
      </ul>
      <table cellpadding="0" cellspacing="0"><tr>
        ${btn('Check This Transaction', FINCEN_URL)}
      </tr></table>
    </div>`;
  }

  const attachedLabels = (data.attachedDocLabels ?? []).filter(Boolean);
  const docHtml = attachedDocsHtml(attachedLabels, data.hasDocuments, data.isTitlePointActive);

  // Action buttons
  const btnCells: string[] = [];
  if (!hideGenerateFees) btnCells.push(btn('Generate Fees', `${APP_URL}/orders/${encodeURIComponent(fn)}/fees`));
  btnCells.push(btn('Generate Proposed', `${APP_URL}/orders/${encodeURIComponent(fn)}/proposed`));
  btnCells.push(btn('Generate CPL', `${APP_URL}/orders/${encodeURIComponent(fn)}/cpl`));
  const actionBtns = `<table cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr>${btnCells.map((b) => b + '<td width="8"></td>').join('')}</tr></table>`;

  // Order / property summary (single clean card — prelim-style details table)
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
  if (data.opener?.phone) summaryRows += row('Opener Telephone', data.opener.phone);
  if (data.opener?.company) summaryRows += row('Opener Company', data.opener.company);
  if (data.transactionType) summaryRows += row('Transaction Type', data.transactionType);
  const summaryHtml = summaryRows
    ? `${sectionHeading('Order & property summary')}${detailsTable(summaryRows)}`
    : '';

  // Tax section — same OC-3 fields, cleaner installment layout
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

  // Seller section
  let sellerHtml = '';
  if (data.seller?.primary) {
    let rows = row('Primary Owner', data.seller.primary);
    if (data.seller.secondary) rows += row('Secondary Owner', data.seller.secondary);
    sellerHtml = `${sectionHeading('Seller / Owner')}${detailsTable(rows)}`;
  }

  // Transaction section
  let txHtml = '';
  {
    let rows = '';
    if (data.assignments?.salesRep) rows += row('Sales Rep', data.assignments.salesRep);
    if (data.assignments?.titleOfficer) rows += row('Title Officer', data.assignments.titleOfficer);
    if (data.productType) rows += row('Product', data.productType);
    if (data.salesPrice) rows += row('Sales Price', data.salesPrice);
    if (data.loanAmount) rows += row('Loan Amount', data.loanAmount);
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

  // Body sits inside shared emailLayout (PCT logo header + www.pct.com footer) — same shell as prelim-delivery.
  const body = `
    <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:${PCT_NAVY};">Title order opened</p>
    <p style="margin:0 0 6px;font-size:15px;color:${TEXT_PRIMARY};line-height:1.6;">Pacific Coast Title has opened a new order.</p>
    <p style="margin:0 0 20px;font-size:18px;font-weight:700;color:${PCT_NAVY};">Order # ${esc(fn)}</p>
    ${summaryHtml}
    ${docHtml}
    ${taxHtml}
    ${fincenHtml}
    ${actionBtns}
    ${sellerHtml}
    ${txHtml}
    ${partyHtml}
    <table cellpadding="0" cellspacing="0" style="margin:8px 0 0;"><tr>
      ${btn('View Order in Portal', orderUrl)}
    </tr></table>`;

  return {
    subject: `Open Order Confirmation - ${fn}`,
    html: layout('Order Confirmation', body),
  };
}
