const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hub.pctitle.com';

export const PCT_NAVY = '#1B2A4A';
export const PCT_ORANGE = '#F26B2B';
export const TEXT_PRIMARY = '#1B2A4A';
export const TEXT_MUTED = '#526174';
export const BORDER_NAVY = '#1B2A4A';
export const BORDER_SOFT = '#D7DDE5';
export const BG_LIGHT = '#F8F9FA';
export const CARD_BG = '#FFFFFF';
export const ORANGE_TINT = '#FFF4EE';

export function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function detailsRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 14px;font-size:13px;color:${TEXT_MUTED};border-bottom:1px solid ${BORDER_SOFT};width:38%;">${label}</td>
    <td style="padding:10px 14px;font-size:13px;font-weight:600;color:${TEXT_PRIMARY};border-bottom:1px solid ${BORDER_SOFT};">${esc(value)}</td>
  </tr>`;
}

export function button(text: string, href: string): string {
  return `<td style="background:${PCT_ORANGE};border:1px solid ${PCT_ORANGE};border-radius:8px;padding:12px 18px;">
    <a href="${href}" style="color:#FFFFFF;text-decoration:none;font-size:13px;font-weight:700;display:block;">${text}</a>
  </td>`;
}

export function emailLayout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:${BG_LIGHT};font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BG_LIGHT};padding:24px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${CARD_BG};border-radius:16px;overflow:hidden;border:1px solid ${BORDER_SOFT};">
  <tr><td style="background:${PCT_NAVY};padding:20px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="color:#FFFFFF;font-size:20px;font-weight:bold;letter-spacing:.5px;">Pacific Coast Title</td>
      <td align="right" style="color:${PCT_ORANGE};font-size:12px;text-transform:uppercase;letter-spacing:1px;">${esc(title)}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;color:${TEXT_MUTED};font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
  <tr><td style="padding:0 32px 24px;border-top:1px solid ${BORDER_SOFT};">
    <p style="font-size:12px;color:${TEXT_MUTED};margin:16px 0 0;">
      Pacific Coast Title Company &bull; Automated notification<br/>
      <a href="${APP_URL}" style="color:${PCT_ORANGE};text-decoration:none;">hub.pctitle.com</a>
    </p>
  </td></tr>
</table>
</td></tr></table></body></html>`.trim();
}
