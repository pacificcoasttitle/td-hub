import type { DailySummary } from './daily-summary';
import {
  HEADER_BG,
  HERO_BG,
  ORANGE_TINT,
  PCT_DEEP,
  PCT_ORANGE,
  TEXT_BODY,
  TEXT_PRIMARY,
  ctaButton,
  emailShell,
  esc,
} from '@/lib/domain/notifications/email-layout';

/** Verdict first, so it reads from a phone notification. */
export function buildSubject(summary: DailySummary): string {
  const n = summary.attention.length;
  if (n === 0) return `TD Hub — all clear · ${summary.dayLabel}`;
  return `TD Hub — ${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention · ${summary.dayLabel}`;
}

export function buildHeadline(summary: DailySummary): string {
  const n = summary.attention.length;
  if (n === 0) return 'Everything ran clean yesterday.';
  return `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} your attention.`;
}

function numberLines(summary: DailySummary): string[] {
  const n = summary.numbers;
  const lines: string[] = [];

  if (n.ordersFromSoftPro !== null || n.ordersCreatedHere !== null) {
    const parts: string[] = [];
    if (n.ordersFromSoftPro !== null) parts.push(`${n.ordersFromSoftPro} came in from SoftPro`);
    if (n.ordersCreatedHere) parts.push(`${n.ordersCreatedHere} opened here`);
    lines.push(`**Orders** — ${parts.join(', ')}`);
  }
  if (n.prelimsDelivered !== null) {
    const summarised = n.prelimsSummarised ? `, ${n.prelimsSummarised} summarised by TESSA` : '';
    lines.push(`**Title reports** — ${n.prelimsDelivered} received${summarised}`);
  }
  if (n.cplsGenerated !== null) {
    lines.push(`**CPL documents** — ${n.cplsGenerated} generated`);
  }
  if (n.emailsSent !== null) {
    if (n.emailsSent === 0 && !n.emailsFailed) {
      lines.push('**Emails** — none went out');
    } else {
      const failed = n.emailsFailed ? `, ${n.emailsFailed} failed` : ', all delivered';
      lines.push(`**Emails** — ${n.emailsSent} sent${failed}`);
    }
  }
  return lines;
}

function plumbingLine(summary: DailySummary): string | null {
  if (!summary.complete) return null;
  const hadJobTrouble = summary.attention.some((a) =>
    a.includes('background work failed') || a.includes('unreliable'));
  if (hadJobTrouble) return null;
  return 'Everything else—syncs, document fetches, and the email queue—ran on schedule.';
}

function heroCopy(summary: DailySummary): { icon: string; headline: string; subcopy: string } {
  const n = summary.attention.length;
  if (n === 0) {
    return {
      icon: '✓',
      headline: 'All clear.',
      subcopy: `${summary.dayLabel} · Your daily TD Hub operations brief.`,
    };
  }
  const word = n === 1 ? 'One item needs' : n === 2 ? 'Two items need' : `${n} items need`;
  return {
    icon: String(n),
    headline: `${word} attention.`,
    subcopy: `${summary.dayLabel} · Your daily TD Hub operations brief.`,
  };
}

function metricCard(value: string, label: string, bg: string, color: string, muted: string, pad: string): string {
  return `<td width="50%" style="${pad}"><div style="background:${bg};padding:18px;border-radius:12px;color:${color};"><div style="font-size:26px;font-weight:bold;">${esc(value)}</div><div style="color:${muted};font-size:12px;">${esc(label)}</div></div></td>`;
}

export function renderDailySummaryHtml(summary: DailySummary, dashboardUrl: string): string {
  const hero = heroCopy(summary);
  const n = summary.numbers;

  const attentionHtml = summary.attention.length === 0
    ? ''
    : `<p style="margin:0 0 10px;color:${TEXT_PRIMARY};font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Needs attention</p>
${summary.attention.map((item, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${ORANGE_TINT};border-radius:12px;margin:0 0 10px;"><tr><td width="54" style="padding:16px 0 16px 18px;color:${PCT_ORANGE};font-size:26px;font-weight:bold;">${num}</td><td style="padding:16px 18px;color:${TEXT_PRIMARY};font-size:14px;line-height:1.5;">${esc(item)}</td></tr></table>`;
  }).join('')}`;

  const ordersTotal =
    (n.ordersFromSoftPro ?? 0) + (n.ordersCreatedHere ?? 0);
  const ordersLabel = n.ordersFromSoftPro !== null || n.ordersCreatedHere !== null
    ? String(ordersTotal || (n.ordersFromSoftPro ?? n.ordersCreatedHere ?? 0))
    : '—';

  const metrics = `<p style="margin:28px 0 12px;color:${TEXT_PRIMARY};font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Yesterday in numbers</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
${metricCard(ordersLabel, 'Orders received / opened', PCT_DEEP, '#ffffff', '#D8DEE8', 'padding:0 6px 12px 0;')}
${metricCard(n.prelimsDelivered == null ? '—' : String(n.prelimsDelivered), 'Title reports received', HERO_BG, '#ffffff', '#D8DEE8', 'padding:0 0 12px 6px;')}
</tr><tr>
${metricCard(n.cplsGenerated == null ? '—' : String(n.cplsGenerated), 'CPL documents generated', '#F3F4F6', TEXT_PRIMARY, TEXT_BODY, 'padding:0 6px 0 0;')}
${metricCard(n.emailsSent == null ? '—' : String(n.emailsSent), 'Emails sent / delivered', ORANGE_TINT, TEXT_PRIMARY, TEXT_BODY, 'padding:0 0 0 6px;')}
</tr></table>`;

  const plumbing = plumbingLine(summary);
  const plumbingHtml = plumbing
    ? `<p style="margin:22px 0;color:${TEXT_BODY};font-size:13px;line-height:1.55;">${esc(plumbing)}</p>`
    : '';

  const footnote = summary.complete ? '' : `
<p style="margin:16px 0 0;font-size:12px;color:${TEXT_BODY};">
Some parts of this report could not be read (${esc(summary.unavailable.join(', '))}), so a few numbers may be missing.
</p>`;

  const body = `${attentionHtml}${metrics}${plumbingHtml}${footnote}${ctaButton('Open Operations Dashboard', dashboardUrl, HEADER_BG)}`;

  return emailShell({
    title: buildSubject(summary),
    badge: 'Operations',
    preheader: `${summary.dayLabel} · Your daily TD Hub operations brief.`,
    hero: {
      icon: hero.icon,
      eyebrow: 'Daily operations brief',
      headline: hero.headline,
      subcopy: hero.subcopy,
    },
    bodyHtml: body,
  });
}

export function renderDailySummaryText(summary: DailySummary, dashboardUrl: string): string {
  const clean = summary.attention.length === 0;
  const lines: string[] = [
    buildHeadline(summary),
    summary.dayLabel,
    '',
  ];

  if (!clean) {
    lines.push('NEEDS ATTENTION', '');
    summary.attention.forEach((item, i) => lines.push(`${i + 1}. ${item}`, ''));
  }

  const numbers = numberLines(summary);
  if (numbers.length > 0) {
    lines.push('YESTERDAY IN NUMBERS', '');
    for (const line of numbers) lines.push(line.replace(/\*\*/g, ''));
    lines.push('');
  }

  const plumbing = plumbingLine(summary);
  if (plumbing) lines.push(plumbing, '');
  if (!summary.complete) {
    lines.push(`Some parts of this report could not be read (${summary.unavailable.join(', ')}), so a few numbers may be missing.`, '');
  }

  lines.push(`See full detail on the operations dashboard: ${dashboardUrl}`);
  return lines.join('\n');
}
