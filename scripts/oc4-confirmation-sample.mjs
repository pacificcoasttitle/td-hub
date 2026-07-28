/**
 * Renders a sample OC-4 confirmation HTML for before/after review.
 * Run: node scripts/oc4-confirmation-sample.mjs
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Inline a minimal render matching confirmation-template fixtures (no TS import).
// The vitest OC-4 suite is the authoritative proof; this file is for visual review.
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://hub.pctitle.com').replace(/\/+$/, '');
const PCT_NAVY = '#1B2A4A';
const PCT_ORANGE = '#F26B2B';
const TEXT_PRIMARY = '#1B2A4A';
const TEXT_MUTED = '#526174';
const BORDER_SOFT = '#D7DDE5';
const CARD_BG = '#FFFFFF';
const BG_LIGHT = '#F8F9FA';
const logo = `${APP_URL}/logo2-light.png`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const row = (label, value) => `<tr>
    <td style="padding:10px 14px;font-size:13px;color:${TEXT_MUTED};border-bottom:1px solid ${BORDER_SOFT};width:38%;">${label}</td>
    <td style="padding:10px 14px;font-size:13px;font-weight:600;color:${TEXT_PRIMARY};border-bottom:1px solid ${BORDER_SOFT};">${esc(value)}</td>
  </tr>`;

const body = `
    <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:${PCT_NAVY};">Title order opened</p>
    <p style="margin:0 0 6px;font-size:15px;color:${TEXT_PRIMARY};line-height:1.6;">Pacific Coast Title has opened a new order.</p>
    <p style="margin:0 0 20px;font-size:18px;font-weight:700;color:${PCT_NAVY};">Order # 20019999-TEST</p>
    <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${PCT_NAVY};">Order &amp; property summary</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BG};border-radius:10px;margin:0 0 20px;border:1px solid ${BORDER_SOFT};">
      ${row('Order #', '20019999-TEST')}
      ${row('Property', '123 Main St, Glendale, CA 91203')}
      ${row('APN', '5640-012-003')}
      ${row('County', 'Los Angeles')}
      ${row('Legal Description', 'Lot 9 of Tract 1234')}
    </table>
    <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${PCT_NAVY};">Attached documents</p>
    <p style="margin:0 0 10px;font-size:13px;color:${TEXT_MUTED};"><strong style="color:${TEXT_PRIMARY};">Attached:</strong> Legal and Vesting, Tax Roll</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td style="padding:0 0 8px;"><div style="display:inline-block;border:1px solid ${BORDER_SOFT};border-radius:999px;padding:9px 14px;background:#FFFFFF;color:${TEXT_PRIMARY};font-size:13px;font-weight:700;"><span style="color:${PCT_ORANGE};font-size:15px;margin-right:8px;">▣</span>Legal and Vesting</div></td></tr>
      <tr><td style="padding:0 0 8px;"><div style="display:inline-block;border:1px solid ${BORDER_SOFT};border-radius:999px;padding:9px 14px;background:#FFFFFF;color:${TEXT_PRIMARY};font-size:13px;font-weight:700;"><span style="color:${PCT_ORANGE};font-size:15px;margin-right:8px;">▣</span>Tax Roll</div></td></tr>
    </table>
    <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${PCT_NAVY};">Property Tax Details</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BG};border-radius:10px;margin:0 0 20px;border:1px solid ${BORDER_SOFT};">
      ${row('Tax Rate Area', '04-001')}
      ${row('Land Value', '250000')}
      ${row('Improvements Value', '180000')}
      ${row('Tax Rate', '1.1250')}
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>
      <td width="50%" valign="top" style="padding:0 6px 0 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BG};border:1px solid ${BORDER_SOFT};border-radius:10px;">
          <tr><td style="padding:12px 14px 4px;font-size:12px;font-weight:700;color:${PCT_ORANGE};text-transform:uppercase;">1st Installment</td></tr>
          ${row('1st Installment Amount', '2412.50')}
          ${row('1st Installment Balance', '0.00')}
          ${row('1st Installment Due Date', '2025-12-10')}
          ${row('1st Installment Status', 'Paid')}
        </table>
      </td>
      <td width="50%" valign="top" style="padding:0 0 0 6px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BG};border:1px solid ${BORDER_SOFT};border-radius:10px;">
          <tr><td style="padding:12px 14px 4px;font-size:12px;font-weight:700;color:${PCT_ORANGE};text-transform:uppercase;">2nd Installment</td></tr>
          ${row('2nd Installment Amount', '2412.50')}
          ${row('2nd Installment Balance', '2412.50')}
          ${row('2nd Installment Due Date', '2026-04-10')}
          ${row('2nd Installment Status', 'Unpaid')}
        </table>
      </td>
    </tr></table>`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>OC-4 Confirmation Sample (AFTER)</title></head>
<body style="margin:0;padding:0;background:${BG_LIGHT};font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BG_LIGHT};padding:24px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${CARD_BG};border-radius:16px;overflow:hidden;border:1px solid ${BORDER_SOFT};">
  <tr><td style="background:${PCT_NAVY};padding:20px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><img src="${logo}" height="30" alt="Pacific Coast Title" style="display:block;height:30px;width:auto;border:0;"/></td>
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

const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, 'oc4-confirmation-sample-after.html');
writeFileSync(out, html, 'utf8');
console.log(`Wrote ${out}`);
