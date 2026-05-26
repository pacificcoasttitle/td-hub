import { buildDailyReport } from '@/lib/domain/ops/daily-report';
import { formatPacific, renderDailyReportHtml, renderDailyReportText } from '@/lib/domain/ops/daily-report-email';
import { sendEmail } from '@/lib/integrations/sendgrid/client';

export const maxDuration = 60;

export interface OpsDailyReportResult {
  sentTo: string;
  sectionsLoaded: number;
  sectionsFailed: number;
}

export async function handleOpsDailyReport(): Promise<OpsDailyReportResult> {
  const report = await buildDailyReport();
  const html = renderDailyReportHtml(report);
  const text = renderDailyReportText(report);
  const recipient = process.env.OPS_REPORT_RECIPIENT ?? 'ghernandez@pct.com';

  const result = await sendEmail({
    to: recipient,
    subject: `TD Hub Daily Ops Report - ${formatPacific(report.generatedAt, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: undefined,
      minute: undefined,
      timeZoneName: undefined,
    })}`,
    html,
    text,
  });

  if (!result.success) {
    throw new Error(result.error?.message ?? 'Failed to send daily operations report');
  }

  return {
    sentTo: recipient,
    sectionsLoaded: report.sectionsLoaded,
    sectionsFailed: report.sectionsFailed,
  };
}
