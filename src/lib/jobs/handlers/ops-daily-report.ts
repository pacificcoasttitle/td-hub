import { buildDailySummary, degradedSummary } from '@/lib/domain/ops/daily-summary';
import {
  buildSubject, renderDailySummaryHtml, renderDailySummaryText,
} from '@/lib/domain/ops/daily-summary-email';
import { sendEmail } from '@/lib/integrations/sendgrid/client';

export const maxDuration = 60;

/**
 * Overall cap on building the summary. Comfortably inside maxDuration so there
 * is always time left to send. Per-section caps sit under this.
 */
const BUILD_TIMEOUT_MS = 40_000;

/** Falls back to the original address when OPS_REPORT_RECIPIENT is unset. */
const DEFAULT_RECIPIENT = 'ghernandez@pct.com';

export interface OpsDailyReportResult {
  sentTo: string;
  day: string;
  attentionCount: number;
  complete: boolean;
  unavailable: string[];
}

function dashboardUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://td-hub.pctitle.com';
  return `${base.replace(/\/$/, '')}/admin/ops`;
}

/**
 * Sends the daily operations summary for the previous calendar day.
 *
 * Reliability contract: this always reaches a terminal state and always
 * attempts to send. Previously a stalled query could hang the build
 * indefinitely — the job row stayed at 'running' until the watchdog reaped it
 * ten minutes later, and no email went out at all. Now the build is bounded by
 * a hard timeout (with per-section timeouts beneath it) and any failure still
 * produces a short email saying so. A silent skipped day is worse than an
 * honest short one. See docs/ops-daily-report-review.md.
 */
export async function handleOpsDailyReport(): Promise<OpsDailyReportResult> {
  const now = new Date();

  let summary;
  try {
    summary = await Promise.race([
      buildDailySummary(now),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Report build exceeded ${BUILD_TIMEOUT_MS / 1000} seconds.`)),
          BUILD_TIMEOUT_MS,
        ).unref?.();
      }),
    ]);
  } catch (err) {
    summary = degradedSummary(now, err instanceof Error ? err.message : 'Unknown error.');
  }

  const recipient = process.env.OPS_REPORT_RECIPIENT ?? DEFAULT_RECIPIENT;
  const url = dashboardUrl();

  const result = await sendEmail({
    to: recipient,
    subject: buildSubject(summary),
    html: renderDailySummaryHtml(summary, url),
    text: renderDailySummaryText(summary, url),
  });

  if (!result.success) {
    throw new Error(result.error?.message ?? 'Failed to send daily operations report');
  }

  return {
    sentTo: recipient,
    day: summary.dayLabel,
    attentionCount: summary.attention.length,
    complete: summary.complete,
    unavailable: summary.unavailable,
  };
}
