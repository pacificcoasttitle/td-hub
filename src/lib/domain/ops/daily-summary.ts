// Plain-English daily operations summary.
//
// Replaces the fourteen-section technical report for the emailed audience. The
// full detail still lives on /admin/ops; this answers one question — "did
// anything need me yesterday?" — in a few seconds of reading.
//
// Reliability: every section is both fault-isolated AND time-boxed. The old
// report caught thrown errors but had no timeout, so a single stalled query
// hung Promise.all forever, left the job row at 'running', and the watchdog
// reaped it ten minutes later — with no email sent at all. See
// docs/ops-daily-report-review.md.

import {
  getCplsSection,
  getNotificationsSection,
  getOrderFlowSection,
  getPrelimsSection,
  getSyncHealthSection,
  getVendorApiHealthSection,
  type SectionResult,
} from './daily-report';
import { formatDayLabel, previousPacificDay, type CalendarDayWindow } from './calendar-day';
import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

/** Per-section cap. Generous — sections measure well under a second in practice. */
export const SECTION_TIMEOUT_MS = 15_000;

export interface DailySummary {
  /** The calendar day being reported on. */
  dayLabel: string;
  window: CalendarDayWindow;
  generatedAt: Date;
  /** Plain sentences. Empty means nothing needs attention. */
  attention: string[];
  numbers: SummaryNumbers;
  /** False when any section timed out or failed — surfaced as a soft footnote. */
  complete: boolean;
  /** Names of sections that could not be read, for the footnote. */
  unavailable: string[];
}

export interface SummaryNumbers {
  ordersFromSoftPro: number | null;
  ordersCreatedHere: number | null;
  prelimsDelivered: number | null;
  prelimsSummarised: number | null;
  cplsGenerated: number | null;
  emailsSent: number | null;
  emailsFailed: number | null;
}

/**
 * Runs a section with a hard timeout. A timeout or throw yields an unavailable
 * result rather than propagating — the report must always be able to send.
 */
export async function withTimeout<T>(
  label: string,
  work: Promise<SectionResult<T>>,
  ms = SECTION_TIMEOUT_MS,
): Promise<SectionResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<SectionResult<T>>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, error: `${label} timed out after ${ms / 1000}s` }),
          ms,
        );
      }),
    ]);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : `${label} failed` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Emails actually sent, counted from the SendGrid call log.
 *
 * Deliberately NOT taken from notification_logs: that table only records the
 * outbox pipeline (milestones and order confirmations). Prelim deliveries —
 * the bulk of what customers receive — call SendGrid directly and never appear
 * there. Counting notification_logs made the report say "none went out" on a
 * day 38 customer emails were sent.
 */
export async function getEmailsSection(
  windowStart: Date,
  windowEnd: Date,
): Promise<SectionResult<{ sent: number; failed: number }>> {
  try {
    const rows = await db.execute(sql`
      select
        count(*) filter (where success)::int as sent,
        count(*) filter (where not success)::int as failed
      from vendor_api_logs
      where vendor = 'sendgrid'
        and created_at >= ${windowStart.toISOString()}
        and created_at < ${windowEnd.toISOString()}
    `) as unknown as Array<{ sent: number; failed: number }>;
    const row = rows[0];
    return { ok: true, data: { sent: Number(row?.sent ?? 0), failed: Number(row?.failed ?? 0) } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Email counts unavailable' };
  }
}

/** Composes the attention sentences. Pure, so the wording is testable. */
export function composeAttention(input: {
  orderFlow: SectionResult<{ newlyStuckOver6Hours: number }>;
  notifications: SectionResult<{
    confirmationMissingClient: number;
    confirmationNoRecipients: number;
  }>;
  /** Real SendGrid outcomes — see getEmailsSection. */
  emails: SectionResult<{ sent: number; failed: number }>;
  syncHealth: SectionResult<{ rows: Array<{ jobType: string; failed: number }> }>;
  vendorApiHealth: SectionResult<{ rows: Array<{ vendor: string; successRate: number; calls: number }> }>;
  cpls: SectionResult<{ failedByVendor: Array<{ vendor: string; count: number }> }>;
}): string[] {
  const out: string[] = [];

  // Highest-value line in the report: a client did not receive their document.
  if (input.notifications.ok) {
    const n = input.notifications.data;
    if (n.confirmationMissingClient > 0) {
      out.push(
        `${n.confirmationMissingClient} order ${plural(n.confirmationMissingClient, 'confirmation', 'confirmations')} went out without reaching the client. `
        + `The order had no client email on it, so only staff received the confirmation — someone should forward it manually.`,
      );
    }
    if (n.confirmationNoRecipients > 0) {
      out.push(
        `${n.confirmationNoRecipients} order ${plural(n.confirmationNoRecipients, 'confirmation', 'confirmations')} could not be sent to anyone — no email addresses were found on the order.`,
      );
    }
  }

  if (input.emails.ok && input.emails.data.failed > 0) {
    const f = input.emails.data.failed;
    out.push(`${f} ${plural(f, 'email', 'emails')} failed to send.`);
  }

  if (input.orderFlow.ok && input.orderFlow.data.newlyStuckOver6Hours > 0) {
    const n = input.orderFlow.data.newlyStuckOver6Hours;
    out.push(
      `${n} ${plural(n, 'order has', 'orders have')} been waiting more than 6 hours for details. `
      + `${plural(n, 'It', 'They')} arrived from SoftPro but ${plural(n, 'is', 'are')} still missing the property address, sales rep, or escrow officer.`,
    );
  }

  if (input.cpls.ok) {
    const failed = input.cpls.data.failedByVendor.filter((v) => v.count > 0);
    for (const v of failed) {
      out.push(`${v.count} CPL ${plural(v.count, 'document', 'documents')} could not be generated through ${v.vendor}.`);
    }
  }

  if (input.syncHealth.ok) {
    // Several job types share a friendly name (the two enrich jobs are both
    // "order detail lookup"); merge them so the sentence never repeats itself.
    const byFriendly = new Map<string, number>();
    for (const r of input.syncHealth.data.rows) {
      if (r.failed <= 0) continue;
      const name = friendlyJobName(r.jobType);
      byFriendly.set(name, (byFriendly.get(name) ?? 0) + r.failed);
    }
    const failing = [...byFriendly.entries()].sort((a, b) => b[1] - a[1]);
    if (failing.length > 0) {
      const worst = failing.slice(0, 3).map(([name, n]) => `${name} (${n})`);
      out.push(
        `Some background work failed and retried: ${worst.join(', ')}`
        + `${failing.length > 3 ? `, and ${failing.length - 3} more` : ''}. `
        + `This is usually a vendor being briefly unreachable and normally clears on its own.`,
      );
    }
  }

  if (input.vendorApiHealth.ok) {
    for (const v of input.vendorApiHealth.data.rows) {
      // Only worth mentioning with enough volume to be meaningful.
      if (v.calls >= 20 && v.successRate < 95) {
        out.push(
          `${titleCaseVendor(v.vendor)} was unreliable — about ${Math.round(100 - v.successRate)}% of requests failed.`,
        );
      }
    }
  }

  return out;
}

/** Turns `softpro.sync_contacts.sales_rep` into something a human can read. */
export function friendlyJobName(jobType: string): string {
  const map: Record<string, string> = {
    'softpro.sync_recent_orders': 'new order sync',
    'softpro.enrich_orders': 'order detail lookup',
    'softpro.enrich_order_details': 'order detail lookup',
    'softpro.fetch_prelims': 'title report fetch',
    'softpro.sync_all_contacts': 'contact sync',
    'softpro.sync_new_users': 'new user sync',
    'softpro.verify_sync': 'sync verification',
    'softpro.retry_document_attach': 'document upload retry',
    'sitex.backfill_property': 'property data lookup',
    'titlepoint.drain': 'title data lookup',
    'notifications.process_outbox': 'email queue',
    'ops.daily_report': 'this report',
  };
  if (map[jobType]) return map[jobType];
  if (jobType.startsWith('softpro.sync_contacts.')) return 'contact sync';
  return jobType.replace(/[._]/g, ' ');
}

function titleCaseVendor(vendor: string): string {
  const map: Record<string, string> = {
    softpro: 'SoftPro',
    titlepoint: 'TitlePoint',
    sitex: 'SiteX',
    westcor: 'Westcor',
    fnf: 'FNF',
    sendgrid: 'Email delivery',
    anthropic: 'TESSA',
    claude: 'TESSA',
  };
  return map[vendor] ?? vendor;
}

export async function buildDailySummary(now: Date = new Date()): Promise<DailySummary> {
  const window = previousPacificDay(now);
  const { start, end } = window;

  const [orderFlow, prelims, cpls, notifications, emails, syncHealth, vendorApiHealth] = await Promise.all([
    withTimeout('Orders', getOrderFlowSection(start, end)),
    withTimeout('Title reports', getPrelimsSection(start, end)),
    withTimeout('CPLs', getCplsSection(start, end)),
    withTimeout('Order notifications', getNotificationsSection(start, end)),
    withTimeout('Emails', getEmailsSection(start, end)),
    withTimeout('Background jobs', getSyncHealthSection(start, end)),
    withTimeout('Vendor health', getVendorApiHealthSection(start, end)),
  ]);

  const sections: Array<[string, SectionResult<unknown>]> = [
    ['Orders', orderFlow],
    ['Title reports', prelims],
    ['CPLs', cpls],
    ['Order notifications', notifications],
    ['Emails', emails],
    ['Background jobs', syncHealth],
    ['Vendor health', vendorApiHealth],
  ];
  const unavailable = sections.filter(([, s]) => !s.ok).map(([name]) => name);

  return {
    dayLabel: formatDayLabel(window.ymd),
    window,
    generatedAt: now,
    attention: composeAttention({ orderFlow, notifications, emails, syncHealth, vendorApiHealth, cpls }),
    numbers: {
      ordersFromSoftPro: orderFlow.ok ? orderFlow.data.syncedFromSoftPro : null,
      ordersCreatedHere: orderFlow.ok ? orderFlow.data.createdInTdHub : null,
      prelimsDelivered: prelims.ok ? prelims.data.fetched : null,
      prelimsSummarised: prelims.ok ? prelims.data.tessaAnalysesCompleted : null,
      cplsGenerated: cpls.ok ? cpls.data.generatedDocuments : null,
      emailsSent: emails.ok ? emails.data.sent : null,
      emailsFailed: emails.ok ? emails.data.failed : null,
    },
    complete: unavailable.length === 0,
    unavailable,
  };
}

/**
 * Fallback used when the whole build times out or throws. The email still goes
 * out saying so — a silent skipped day is worse than a short honest one.
 */
export function degradedSummary(now: Date, reason: string): DailySummary {
  const window = previousPacificDay(now);
  return {
    dayLabel: formatDayLabel(window.ymd),
    window,
    generatedAt: now,
    attention: [
      `This report could not be produced. ${reason} `
      + `Yesterday's activity is still visible on the operations dashboard.`,
    ],
    numbers: {
      ordersFromSoftPro: null, ordersCreatedHere: null, prelimsDelivered: null,
      prelimsSummarised: null, cplsGenerated: null, emailsSent: null, emailsFailed: null,
    },
    complete: false,
    unavailable: ['Everything'],
  };
}
