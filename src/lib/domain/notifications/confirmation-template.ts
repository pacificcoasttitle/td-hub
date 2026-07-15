import {
  BORDER_NAVY,
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
  isTitlePointActive: boolean;
}

function table(rows: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BG};border-radius:10px;margin:0;border:1px solid ${BORDER_SOFT};">${rows}</table>`;
}

function section(title: string, content: string): string {
  return `<div style="background:${CARD_BG};border:1px solid ${BORDER_NAVY};border-radius:12px;padding:18px 18px 16px;margin:0 0 18px;">
    <h3 style="color:${PCT_NAVY};margin:0 0 12px;font-size:15px;font-weight:700;border-bottom:3px solid ${PCT_ORANGE};padding-bottom:8px;">${title}</h3>
    ${content}
  </div>`;
}

function partyBlock(label: string, p: ConfirmationParty | null | undefined): string {
  if (!p || (!p.name && !p.email)) return '';
  let rows = '';
  if (p.name) rows += row('Name', p.name);
  if (p.email) rows += row('Email', p.email);
  if (p.phone) rows += row('Telephone', p.phone);
  if (p.company) rows += row('Company', p.company);
  return section(label, table(rows));
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
    <div style="background:${ORANGE_TINT};border:1px solid ${PCT_ORANGE};border-radius:12px;padding:18px;margin:0 0 18px;">
      <h3 style="color:${PCT_NAVY};margin:0 0 8px;font-size:15px;font-weight:700;">FinCEN Reporting Quick Check</h3>
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

  // Document note
  const docHtml = data.hasDocuments
    ? `<div style="background:${CARD_BG};border:1px solid ${BORDER_SOFT};border-left:4px solid ${PCT_ORANGE};border-radius:12px;padding:14px 16px;margin:0 0 18px;">
        <p style="margin:0;font-size:13px;color:${TEXT_PRIMARY};"><strong>Attached:</strong> Legal and Vesting, Recent Grant Deed, Tax Roll</p>
      </div>`
    : data.isTitlePointActive
      ? `<div style="background:${CARD_BG};border:1px solid ${BORDER_SOFT};border-left:4px solid ${PCT_ORANGE};border-radius:12px;padding:14px 16px;margin:0 0 18px;">
          <p style="margin:0;font-size:13px;color:${TEXT_MUTED};">Documents are being generated and will be available shortly.</p>
        </div>`
      : `<div style="background:${CARD_BG};border:1px solid ${BORDER_SOFT};border-left:4px solid ${PCT_ORANGE};border-radius:12px;padding:14px 16px;margin:0 0 18px;">
          <p style="margin:0;font-size:13px;color:${TEXT_MUTED};">TitlePoint is currently offline. Documents will be available when service resumes.</p>
        </div>`;

  // Action buttons
  let actionBtns = '';
  const btnCells: string[] = [];
  if (!hideGenerateFees) btnCells.push(btn('Generate Fees', `${APP_URL}/orders/${encodeURIComponent(fn)}/fees`));
  btnCells.push(btn('Generate Proposed', `${APP_URL}/orders/${encodeURIComponent(fn)}/proposed`));
  btnCells.push(btn('Generate CPL', `${APP_URL}/orders/${encodeURIComponent(fn)}/cpl`));
  actionBtns = `<table cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr>${btnCells.map((b) => b + '<td width="8"></td>').join('')}</tr></table>`;

  // Opener section
  let openerHtml = '';
  if (data.opener && (data.opener.name || data.opener.email)) {
    let rows = '';
    if (data.opener.name) rows += row('Opened By', data.opener.name);
    if (data.opener.email) rows += row('Email', data.opener.email);
    if (data.opener.phone) rows += row('Telephone', data.opener.phone);
    if (data.opener.company) rows += row('Company', data.opener.company);
    openerHtml = section('Order Summary', table(rows));
  }

  // Property section
  let propHtml = '';
  if (data.property) {
    let rows = '';
    const addr = [data.property.address, data.property.city, data.property.zip].filter(Boolean).join(', ');
    if (addr) rows += row('Property Address', addr);
    if (data.property.apn) rows += row('APN', data.property.apn);
    if (data.property.county) rows += row('County', data.property.county);
    if (data.property.legalDescription) rows += row('Legal Description', data.property.legalDescription);
    if (rows) propHtml = section('Property Details', table(rows));
  }

  // Tax section
  let taxHtml = '';
  if (data.taxData) {
    const td = data.taxData;
    let rows = '';
    if (td.taxRateArea) rows += row('Tax Rate Area', td.taxRateArea);
    if (td.useCode) rows += row('Use Code', td.useCode);
    if (td.regionCode) rows += row('Region Code', td.regionCode);
    if (td.floodZone) rows += row('Flood Zone', td.floodZone);
    if (td.zoningCode) rows += row('Zoning Code', td.zoningCode);
    if (td.taxRate) rows += row('Tax Rate', td.taxRate);
    if (td.issueDate) rows += row('Issue Date', td.issueDate);
    if (td.landValue) rows += row('Land Value', td.landValue);
    if (td.improvementsValue) rows += row('Improvements Value', td.improvementsValue);
    rows += installmentRows('1st Installment', td.firstInstallment);
    rows += installmentRows('2nd Installment', td.secondInstallment);
    if (rows) taxHtml = section('Property Tax Details', table(rows));
  }

  // Seller section
  let sellerHtml = '';
  if (data.seller?.primary) {
    let rows = row('Primary Owner', data.seller.primary);
    if (data.seller.secondary) rows += row('Secondary Owner', data.seller.secondary);
    sellerHtml = section('Seller / Owner', table(rows));
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
    if (rows) txHtml = section('Transaction Details', table(rows));
  }

  // Party sections
  const partyHtml = [
    partyBlock('Buyer Agent', data.parties?.buyerAgent),
    partyBlock('Listing Agent', data.parties?.listingAgent),
    partyBlock('Lender', data.parties?.lender),
    partyBlock('Escrow', data.parties?.escrow),
  ].join('');

  const body = `
    <div style="background:${PCT_NAVY};border-radius:14px;padding:24px;margin:0 0 20px;">
      <h2 style="color:#FFFFFF;margin:0 0 6px;font-size:26px;font-weight:700;">Title Order Opened!</h2>
      <p style="margin:0 0 6px;font-size:14px;color:#D7DDE5;">Pacific Coast Title has opened a new order.</p>
      <p style="margin:0;font-size:18px;font-weight:700;color:#FFFFFF;">Order # ${esc(fn)}</p>
    </div>
    ${fincenHtml}${docHtml}${actionBtns}${openerHtml}${propHtml}${taxHtml}${sellerHtml}${txHtml}${partyHtml}
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
      ${btn('View Order in Portal', orderUrl)}
    </tr></table>`;

  return {
    subject: `Open Order Confirmation - ${fn}`,
    html: layout('Order Confirmation', body),
  };
}
