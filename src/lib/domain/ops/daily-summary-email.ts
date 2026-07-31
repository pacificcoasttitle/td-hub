// Renders the plain-English daily summary. Design rule: the answer is in the
// first two lines and the reader may stop there.

import type { DailySummary } from './daily-summary';

const NAVY = '#1B2A4A';
const MUTED = '#6B7280';
const GREEN = '#16A34A';
const AMBER = '#B45309';
const BORDER = '#E5E7EB';

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

/** One sentence standing in for the old per-job and per-vendor tables. */
function plumbingLine(summary: DailySummary): string | null {
  if (!summary.complete) return null;
  const hadJobTrouble = summary.attention.some((a) =>
    a.includes('background work failed') || a.includes('unreliable'));
  if (hadJobTrouble) return null;
  return 'Everything else — syncs, document fetches and the email queue — ran on schedule.';
}

export function renderDailySummaryHtml(summary: DailySummary, dashboardUrl: string): string {
  const clean = summary.attention.length === 0;
  const accent = clean ? GREEN : AMBER;

  const attentionHtml = clean ? '' : `
    <section style="margin-top:24px;">
      <h2 style="margin:0 0 12px;font-size:15px;color:${NAVY};">Needs attention</h2>
      ${summary.attention.map((item, i) => `
        <div style="margin-bottom:12px;padding:12px 14px;background:#FFFBEB;border-left:4px solid ${AMBER};border-radius:4px;">
          <p style="margin:0;font-size:14px;line-height:1.5;color:#111827;"><strong>${i + 1}.</strong> ${escapeHtml(item)}</p>
        </div>`).join('')}
    </section>`;

  const numbers = numberLines(summary);
  const numbersHtml = numbers.length === 0 ? '' : `
    <section style="margin-top:24px;">
      <h2 style="margin:0 0 10px;font-size:15px;color:${NAVY};">Yesterday in numbers</h2>
      ${numbers.map((line) => `<p style="margin:0 0 7px;font-size:14px;color:#111827;">${boldToHtml(line)}</p>`).join('')}
    </section>`;

  const plumbing = plumbingLine(summary);
  const plumbingHtml = plumbing
    ? `<p style="margin:14px 0 0;font-size:13px;color:${MUTED};">${escapeHtml(plumbing)}</p>`
    : '';

  const footnote = summary.complete ? '' : `
    <p style="margin:16px 0 0;font-size:12px;color:${MUTED};">
      Some parts of this report could not be read (${escapeHtml(summary.unavailable.join(', '))}), so a few numbers may be missing.
    </p>`;

  return `<!doctype html>
<html>
<body style="margin:0;background:#F3F4F6;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#111827;">
  <div style="max-width:600px;margin:0 auto;background:#FFFFFF;">
    <div style="padding:28px 28px 4px;">
      <div style="font-size:22px;font-weight:700;color:${accent};">
        ${clean ? '&#10003;' : '&#9888;'} ${escapeHtml(buildHeadline(summary))}
      </div>
      <p style="margin:6px 0 0;font-size:13px;color:${MUTED};">${escapeHtml(summary.dayLabel)}</p>
    </div>
    <div style="padding:0 28px 28px;">
      ${attentionHtml}
      ${numbersHtml}
      ${plumbingHtml}
      ${footnote}
      <div style="margin-top:26px;padding-top:16px;border-top:1px solid ${BORDER};">
        <a href="${escapeAttr(dashboardUrl)}" style="color:${NAVY};font-size:13px;font-weight:600;text-decoration:none;">See full detail on the operations dashboard &rarr;</a>
      </div>
    </div>
  </div>
</body>
</html>`;
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

function boldToHtml(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
