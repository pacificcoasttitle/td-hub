/**
 * Visual before/after samples for Purchase + Refinance confirmation polish.
 * Run: node scripts/oc-email-polish-samples.mjs
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://hub.pctitle.com').replace(/\/+$/, '');
const PCT_NAVY = '#1B2A4A';
const PCT_ORANGE = '#F26B2B';
const TEXT_PRIMARY = '#1B2A4A';
const TEXT_MUTED = '#526174';
const BORDER_SOFT = '#D7DDE5';
const CARD_BG = '#FFFFFF';
const BG_LIGHT = '#F8F9FA';
const ORANGE_TINT = '#FFF4EE';
const logo = `${APP_URL}/logo2-light.png`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const row = (label, value) => `<tr>
    <td style="padding:10px 14px;font-size:13px;color:${TEXT_MUTED};border-bottom:1px solid ${BORDER_SOFT};width:38%;">${label}</td>
    <td style="padding:10px 14px;font-size:13px;font-weight:600;color:${TEXT_PRIMARY};border-bottom:1px solid ${BORDER_SOFT};">${esc(value)}</td>
  </tr>`;
const pill = (label, href) => {
  const inner = `<span style="color:${PCT_ORANGE};font-size:15px;margin-right:8px;">▣</span>${esc(label)}`;
  const content = href
    ? `<a href="${href}" style="color:${TEXT_PRIMARY};text-decoration:none;font-size:13px;font-weight:700;">${inner}</a>`
    : `<span style="font-size:13px;font-weight:700;color:${TEXT_PRIMARY};">${inner}</span>`;
  return `<div style="display:inline-block;border:1px solid ${BORDER_SOFT};border-radius:999px;padding:9px 14px;background:#FFFFFF;">${content}</div>`;
};

function shell(title, body) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${BG_LIGHT};font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BG_LIGHT};padding:24px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${CARD_BG};border-radius:16px;overflow:hidden;border:1px solid ${BORDER_SOFT};">
  <tr><td style="background:${PCT_NAVY};padding:20px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><img src="${logo}" height="30" alt="Pacific Coast Title" style="display:block;height:30px;"/></td>
      <td align="right" style="color:${PCT_ORANGE};font-size:12px;text-transform:uppercase;letter-spacing:1px;">Order Confirmation</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;color:${TEXT_MUTED};font-size:15px;line-height:1.6;">${body}</td></tr>
  <tr><td style="padding:0 32px 24px;border-top:1px solid ${BORDER_SOFT};">
    <p style="font-size:12px;color:${TEXT_MUTED};margin:16px 0 0;">
      Pacific Coast Title Company &bull; Automated notification<br/>
      <a href="https://www.pct.com" style="color:${PCT_ORANGE};text-decoration:none;">www.pct.com</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function afterBody({ txType, moneyRowLabel, moneyRowValue }) {
  const actions = ['Generate Fees', 'Generate Proposed', 'Generate CPL', 'View Order in Portal']
    .map((l) => `<td style="padding:0 8px 8px 0;">${pill(l, '#')}</td>`).join('');
  const docs = ['Legal and Vesting', 'Tax Roll']
    .map((l) => `<td style="padding:0 8px 8px 0;">${pill(l)}</td>`).join('');
  return `
    <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:${PCT_NAVY};">Title order opened</p>
    <p style="margin:0 0 6px;font-size:15px;color:${TEXT_PRIMARY};">Pacific Coast Title has opened a new order.</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:${PCT_NAVY};">Order # 20019999-TEST</p>
    <div style="background:${ORANGE_TINT};border:1px solid ${PCT_ORANGE};border-radius:12px;padding:16px 18px;margin:0 0 20px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:${PCT_ORANGE};text-transform:uppercase;letter-spacing:0.06em;">Your Title Officer</p>
      <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:${PCT_NAVY};">Terry Title</p>
      <p style="margin:0;font-size:13px;color:${TEXT_PRIMARY};">terry.to@pct.com · (626) 555-0100</p>
      <p style="margin:8px 0 0;font-size:12px;color:${TEXT_MUTED};">Questions about this order? Contact your title officer above.</p>
    </div>
    <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${PCT_NAVY};">Quick actions</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>${actions}</tr></table>
    <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${PCT_NAVY};">Order &amp; property summary</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER_SOFT};border-radius:10px;margin:0 0 20px;">
      ${row('Order #', '20019999-TEST')}
      ${row('Property', '123 Main St, Glendale, CA 91203')}
      ${row('Transaction Type', txType)}
      ${row(moneyRowLabel, moneyRowValue)}
    </table>
    <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${PCT_NAVY};">Attached documents</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>${docs}</tr></table>
    <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${PCT_NAVY};">Property Tax Details</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER_SOFT};border-radius:10px;">
      ${row('Tax Rate Area', '04-001')}
      ${row('Land Value', '250000')}
    </table>`;
}

function beforeBody({ txType, badMoney }) {
  return `
    <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:${PCT_NAVY};">Title order opened</p>
    <p style="margin:0 0 20px;font-size:18px;font-weight:700;color:${PCT_NAVY};">Order # 20019999-TEST</p>
    <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${PCT_NAVY};">Order &amp; property summary</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER_SOFT};border-radius:10px;margin:0 0 20px;">
      ${row('Order #', '20019999-TEST')}
      ${row('Transaction Type', txType)}
    </table>
    <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${PCT_NAVY};">Transaction details</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER_SOFT};border-radius:10px;margin:0 0 20px;">
      ${row('Title Officer', 'Terry Title')}
      ${badMoney}
    </table>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr>
      <td style="background:${PCT_ORANGE};border-radius:8px;padding:12px 18px;"><a href="#" style="color:#fff;text-decoration:none;font-weight:700;">Generate Fees</a></td>
      <td width="8"></td>
      <td style="background:${PCT_ORANGE};border-radius:8px;padding:12px 18px;"><a href="#" style="color:#fff;text-decoration:none;font-weight:700;">Generate CPL</a></td>
    </tr></table>
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="background:${PCT_ORANGE};border-radius:8px;padding:12px 18px;"><a href="#" style="color:#fff;text-decoration:none;font-weight:700;">View Order in Portal</a></td>
    </tr></table>`;
}

const dir = dirname(fileURLToPath(import.meta.url));
const files = [
  ['oc-email-polish-purchase-before.html', shell('Purchase BEFORE', beforeBody({ txType: 'Purchase', badMoney: row('Sales Price', '$0') }))],
  ['oc-email-polish-purchase-after.html', shell('Purchase AFTER', afterBody({ txType: 'Purchase', moneyRowLabel: 'Sales Price', moneyRowValue: '$500,000' }))],
  ['oc-email-polish-refinance-before.html', shell('Refinance BEFORE', beforeBody({ txType: 'Refinance', badMoney: `${row('Sales Price', '$500,000')}${row('Loan Amount', '$425,000')}` }))],
  ['oc-email-polish-refinance-after.html', shell('Refinance AFTER', afterBody({ txType: 'Refinance', moneyRowLabel: 'Loan Amount', moneyRowValue: '$425,000' }))],
];

for (const [name, html] of files) {
  const out = join(dir, name);
  writeFileSync(out, html, 'utf8');
  console.log(`Wrote ${out}`);
}
