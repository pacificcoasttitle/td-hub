/**
 * The email that tells a rep a report branded to them is ready.
 *
 * NOTIFY REP IS NOT SEND TO AGENT. This goes to OUR rep, whose name is on the
 * leave-behind; it is not delivery to an outside agent, and nothing here is
 * named "send". The report's three names are used exactly — Sales Activity,
 * Carrier Route Analysis, County Sales — because legacy's two subjects were
 * swapped ("Sales Activity Report Ready!" was the County report).
 *
 * The PDF is ATTACHED, never linked. Legacy emailed a public S3 URL; the URLs
 * were guessable and the reports carry sales data.
 */
import {
  ORANGE_TINT, PCT_ORANGE, TEXT_MUTED, TEXT_PRIMARY, emailShell, esc,
} from '@/lib/domain/notifications/email-layout';
import type { FarmingType } from './stored';

export const REPORT_NAMES: Record<FarmingType, string> = {
  sales_activity: 'Sales Activity',
  carrier_route: 'Carrier Route Analysis',
  county_sales: 'County Sales',
};

export interface NotifyContent {
  type: FarmingType;
  repName: string;
  subject: string | null;
  subjectDetail: string | null;
  settings: string | null;
}

/** "Sales Activity · Santa Monica · 6 months to August 2026" */
export function notifySubject(c: NotifyContent): string {
  return [REPORT_NAMES[c.type], c.subject, c.settings].filter(Boolean).join(' · ');
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] || 'there';

export function notifyText(c: NotifyContent): string {
  const what = [c.subject, c.subjectDetail, c.settings].filter(Boolean).join(', ');
  return [
    `Hi ${firstName(c.repName)},`,
    '',
    `A ${REPORT_NAMES[c.type]} report has been prepared for you${what ? `: ${what}` : ''}.`,
    '',
    'It is attached as a PDF, branded with your name and contact details, ready to hand to an agent.',
    '',
    'Pacific Coast Title Company',
  ].join('\n');
}

export function notifyHtml(c: NotifyContent): string {
  const rows = [
    ['Report', REPORT_NAMES[c.type]],
    ['For', [c.subject, c.subjectDetail].filter(Boolean).join(' — ')],
    ['Covering', c.settings ?? ''],
  ].filter(([, v]) => v);

  const table = rows.map(([k, v]) => `<tr>
<td style="padding:6px 0;color:${TEXT_MUTED};font-size:13px;width:110px;vertical-align:top;">${esc(k!)}</td>
<td style="padding:6px 0;color:${TEXT_PRIMARY};font-size:14px;font-weight:bold;">${esc(v!)}</td></tr>`).join('');

  const body = `<p style="margin:0 0 18px;color:${TEXT_PRIMARY};">Hi ${esc(firstName(c.repName))},</p>
<p style="margin:0 0 20px;">A report has been prepared for you. It is attached as a PDF, branded with your name and contact details, ready to hand to an agent.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${ORANGE_TINT};border-radius:14px;"><tr><td style="padding:18px 22px;">
<p style="margin:0 0 8px;color:${PCT_ORANGE};font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Attached</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0">${table}</table>
</td></tr></table>
<p style="margin:22px 0 0;color:${TEXT_MUTED};font-size:13px;">Figures come from the file the report was built from. Each page says how many rows it read and how many it could not use.</p>`;

  return emailShell({
    title: notifySubject(c),
    badge: 'Report ready',
    preheader: `${REPORT_NAMES[c.type]} report attached${c.subject ? ` — ${c.subject}` : ''}.`,
    hero: {
      icon: '→',
      eyebrow: REPORT_NAMES[c.type],
      headline: c.subject ? `${c.subject}, ready for you.` : 'Your report is ready.',
      subcopy: c.settings ?? 'Attached as a PDF.',
    },
    bodyHtml: body,
  });
}
