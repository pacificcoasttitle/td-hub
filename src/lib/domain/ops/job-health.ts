/**
 * The reader: a background job that is failing or stalled reaches a person.
 *
 * ─── WHY ────────────────────────────────────────────────────────────────────
 *
 * On 2026-09-16 notifications.outstanding_documents_alert failed 538 runs in a
 * row over 14 hours. Every failure was recorded, with an error message, and
 * nothing read the records. softpro.enrich_orders reported "completed" for two
 * weeks while never reading 482 hub-created orders. Better records alone would
 * have caught neither; this is the part that looks.
 *
 * ─── WHAT COUNTS ────────────────────────────────────────────────────────────
 *
 * FAILING — a job type whose last three finished runs all failed, or that ran
 * at least twice in the last hour and failed every time. Measured over the
 * seven days to 2026-09-17, the hourly rule fired for exactly one job type —
 * the outstanding-documents outage, 17 hours — and nothing else.
 *
 * STALLED — work waiting that nothing is doing. Where it can be, the backlog is
 * measured INDEPENDENTLY of the job's own selector, because a selector that
 * cannot see work also reports none: that is precisely how the enrich gap
 * stayed invisible. Independent checks:
 *   - contacts: orders never read from SoftPro, over an hour old, and not
 *     attempted within the retry cooldown plus an hour
 *   - outbox: retryable events waiting more than 30 minutes (it runs every minute)
 *   - TitlePoint queue: poll items overdue by more than 30 minutes
 * For four jobs with no independent measure, their own saved result is used: at
 * least two runs in the last hour, each reporting work waiting and doing none.
 * Over 12 hours to 2026-09-17 that never happened, so it is not noise.
 *
 * ─── HOW IT TELLS SOMEONE ───────────────────────────────────────────────────
 *
 * By email, sent directly — not through event_outbox, because the outbox is one
 * of the things being watched and a stalled outbox must not swallow its own
 * alert. Recipients are the `ops.jobs.unhealthy` notification type's internal_cc
 * (Admin → Notifications). job_health_alerts remembers what was said: one email
 * when a condition starts, a reminder every REMIND_AFTER_HOURS while it lasts,
 * one when it clears. A send that fails leaves the alert unsent, so the next
 * check tries again.
 *
 * Runs inside jobs.watchdog, every 15 minutes. If this check itself throws, the
 * watchdog run records it as an error, which the daily summary reports.
 */
import { eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobHealthAlerts, notificationTypes } from '@/lib/db/schema';
import { OUTBOX_MAX_FAIL_COUNT } from '@/lib/domain/notifications/outbox-claim';
import { calloutBar, emailShell, esc, fieldTable, sectionLabel } from '@/lib/domain/notifications/email-layout';
import { sendEmail } from '@/lib/integrations/sendgrid/client';

export const JOB_HEALTH_ALERT_SLUG = 'ops.jobs.unhealthy';
export const FAILING_CONSECUTIVE_RUNS = 3;
export const FAILING_HOUR_MIN_RUNS = 2;
export const STALLED_RESULT_MIN_RUNS = 2;
export const REMIND_AFTER_HOURS = 6;

/** Queue items, not scheduled runs: individual items failing and retrying is their normal life. */
export const QUEUE_ITEM_JOB_TYPES: readonly string[] = ['titlepoint.poll'];

/** Jobs whose only measure of waiting work is their own saved result. */
export const RESULT_BACKLOG_JOBS: Readonly<Record<string, { backlog: string; work: string }>> = {
  'softpro.enrich_order_details': { backlog: 'eligible', work: 'attempted' },
  'sitex.backfill_property': { backlog: 'eligible', work: 'attempted' },
  'softpro.fetch_prelims': { backlog: 'total', work: 'attempted' },
  'softpro.retry_document_attach': { backlog: 'total', work: 'attempted' },
};

export type HealthCondition = 'failing' | 'stalled';

export interface HealthIssue {
  jobType: string;
  condition: HealthCondition;
  summary: string;
  detail: Record<string, unknown>;
}

export interface RecentRun {
  jobType: string;
  status: 'completed' | 'failed';
  createdAt: Date;
  error: string | null;
}

export interface RecentResult {
  jobType: string;
  createdAt: Date;
  result: Record<string, unknown> | null;
}

export interface OpenAlert {
  id: number;
  jobType: string;
  condition: string;
  summary: string;
  openedAt: Date;
  lastAlertedAt: Date | null;
}

const HOUR_MS = 60 * 60 * 1000;

/** Timestamps come back from raw SQL as UTC text without a zone. */
export function utcDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
}

// ─── Pure decisions ─────────────────────────────────────────────────────────

/** `runs` newest first per job type, or in any order — they are sorted here. */
export function failingIssues(runs: readonly RecentRun[], now: Date): HealthIssue[] {
  const byType = new Map<string, RecentRun[]>();
  for (const run of runs) {
    if (QUEUE_ITEM_JOB_TYPES.includes(run.jobType)) continue;
    byType.set(run.jobType, [...(byType.get(run.jobType) ?? []), run]);
  }

  const issues: HealthIssue[] = [];
  for (const [jobType, list] of byType) {
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const lastThree = list.slice(0, FAILING_CONSECUTIVE_RUNS);
    const lastHour = list.filter((r) => now.getTime() - r.createdAt.getTime() <= HOUR_MS);

    const threeInARow = lastThree.length === FAILING_CONSECUTIVE_RUNS && lastThree.every((r) => r.status === 'failed');
    const everyRunThisHour = lastHour.length >= FAILING_HOUR_MIN_RUNS && lastHour.every((r) => r.status === 'failed');
    if (!threeInARow && !everyRunThisHour) continue;

    let consecutive = 0;
    while (consecutive < list.length && list[consecutive]!.status === 'failed') consecutive++;
    const since = list[consecutive - 1]!.createdAt;
    issues.push({
      jobType,
      condition: 'failing',
      summary: `Failed ${consecutive} ${consecutive === 1 ? 'run' : 'runs'} in a row since ${since.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
      detail: { consecutiveFailures: consecutive, since: since.toISOString(), lastError: list[0]!.error },
    });
  }
  return issues;
}

function numberAt(result: Record<string, unknown> | null, key: string): number | null {
  const v = result?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function resultStallIssues(results: readonly RecentResult[], now: Date): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const [jobType, keys] of Object.entries(RESULT_BACKLOG_JOBS)) {
    const hour = results.filter((r) => r.jobType === jobType && now.getTime() - r.createdAt.getTime() <= HOUR_MS);
    if (hour.length < STALLED_RESULT_MIN_RUNS) continue;
    const idle = hour.every((r) => (numberAt(r.result, keys.backlog) ?? 0) > 0 && (numberAt(r.result, keys.work) ?? 0) === 0);
    if (!idle) continue;
    const waiting = Math.max(...hour.map((r) => numberAt(r.result, keys.backlog) ?? 0));
    issues.push({
      jobType,
      condition: 'stalled',
      summary: `Every run in the last hour (${hour.length}) reported ${waiting} waiting and did none of it.`,
      detail: { runs: hour.length, waiting, backlogField: keys.backlog, workField: keys.work },
    });
  }
  return issues;
}

export interface BacklogCounts {
  contactsNeverRead: number;
  contactsOldest: string | null;
  outboxWaiting: number;
  outboxOldest: string | null;
  titlepointOverdue: number;
  titlepointOldest: string | null;
}

export function backlogIssues(counts: BacklogCounts): HealthIssue[] {
  const issues: HealthIssue[] = [];
  if (counts.contactsNeverRead > 0) {
    issues.push({
      jobType: 'softpro.enrich_orders',
      condition: 'stalled',
      summary: `${counts.contactsNeverRead} ${counts.contactsNeverRead === 1 ? 'order has' : 'orders have'} never had SoftPro contacts read and ${counts.contactsNeverRead === 1 ? 'is' : 'are'} not being attempted.`,
      detail: { orders: counts.contactsNeverRead, oldestCreatedAt: counts.contactsOldest },
    });
  }
  if (counts.outboxWaiting > 0) {
    issues.push({
      jobType: 'notifications.process_outbox',
      condition: 'stalled',
      summary: `${counts.outboxWaiting} queued ${counts.outboxWaiting === 1 ? 'notification has' : 'notifications have'} waited more than 30 minutes to send.`,
      detail: { events: counts.outboxWaiting, oldestCreatedAt: counts.outboxOldest },
    });
  }
  if (counts.titlepointOverdue > 0) {
    issues.push({
      jobType: 'titlepoint.drain',
      condition: 'stalled',
      summary: `${counts.titlepointOverdue} TitlePoint ${counts.titlepointOverdue === 1 ? 'search is' : 'searches are'} overdue by more than 30 minutes.`,
      detail: { items: counts.titlepointOverdue, oldestCreatedAt: counts.titlepointOldest },
    });
  }
  return issues;
}

export interface HealthPlan {
  toOpen: HealthIssue[];
  toRemind: Array<{ alert: OpenAlert; issue: HealthIssue }>;
  stillOpen: Array<{ alert: OpenAlert; issue: HealthIssue }>;
  toResolve: OpenAlert[];
}

export function planHealthAlerts(current: readonly HealthIssue[], open: readonly OpenAlert[], now: Date): HealthPlan {
  const key = (jobType: string, condition: string) => `${jobType} ${condition}`;
  const openByKey = new Map(open.map((a) => [key(a.jobType, a.condition), a]));
  const currentKeys = new Set(current.map((i) => key(i.jobType, i.condition)));

  const plan: HealthPlan = { toOpen: [], toRemind: [], stillOpen: [], toResolve: [] };
  for (const issue of current) {
    const alert = openByKey.get(key(issue.jobType, issue.condition));
    if (!alert) {
      plan.toOpen.push(issue);
    } else if (!alert.lastAlertedAt || now.getTime() - alert.lastAlertedAt.getTime() >= REMIND_AFTER_HOURS * HOUR_MS) {
      plan.toRemind.push({ alert, issue });
    } else {
      plan.stillOpen.push({ alert, issue });
    }
  }
  plan.toResolve = open.filter((a) => !currentKeys.has(key(a.jobType, a.condition)));
  return plan;
}

// ─── The email ──────────────────────────────────────────────────────────────

function appUrl(): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? 'https://td-hub.pctitle.com').replace(/\/$/, '')}/admin/ops`;
}

export function buildJobHealthEmail(plan: HealthPlan): { subject: string; html: string } | null {
  const starting = plan.toOpen;
  const continuing = plan.toRemind;
  const cleared = plan.toResolve;
  if (starting.length + continuing.length + cleared.length === 0) return null;

  const problems = starting.length + continuing.length;
  const first = starting[0] ?? continuing[0]?.issue;
  const subject = problems > 0
    ? `Background job ${first!.condition === 'failing' ? 'failing' : 'stalled'}: ${first!.jobType}${problems > 1 ? ` (+${problems - 1} more)` : ''}`
    : `Background job recovered: ${cleared[0]!.jobType}${cleared.length > 1 ? ` (+${cleared.length - 1} more)` : ''}`;

  const row = (issue: HealthIssue) => ({
    label: `${issue.jobType} — ${issue.condition}`,
    valueHtml: esc(issue.summary)
      + (typeof issue.detail.lastError === 'string' ? `<br><span style="font-weight:normal;">Last error: ${esc(issue.detail.lastError.slice(0, 300))}</span>` : ''),
  });

  const parts: string[] = [];
  if (starting.length) parts.push(sectionLabel('Started'), fieldTable(starting.map(row)));
  if (continuing.length) {
    parts.push(sectionLabel('Still happening'), fieldTable(continuing.map(({ alert, issue }) => ({
      ...row(issue),
      label: `${issue.jobType} — ${issue.condition} (since ${alert.openedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
    }))));
  }
  if (cleared.length) {
    parts.push(sectionLabel('Cleared'), fieldTable(cleared.map((a) => ({
      label: `${a.jobType} — ${a.condition}`,
      valueHtml: `No longer seen. It started ${esc(a.openedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC.`,
    }))));
  }
  parts.push(calloutBar(
    problems > 0
      ? `<strong>Something that runs in the background is not doing its job.</strong> The Operations panel shows each job's runs and last error: <a href="${esc(appUrl())}">${esc(appUrl())}</a>. This reminds every ${REMIND_AFTER_HOURS} hours until it clears.`
      : 'Nothing needs doing. This is the all-clear for an earlier alert.',
  ));

  return {
    subject,
    html: emailShell({
      title: subject,
      badge: problems > 0 ? 'Needs attention' : 'Recovered',
      preheader: subject,
      hero: {
        icon: problems > 0 ? '!' : '✓',
        eyebrow: 'Background jobs',
        headline: problems > 0 ? 'A job is failing or stalled' : 'A job has recovered',
        subcopy: 'Checked every 15 minutes by the jobs watchdog.',
      },
      bodyHtml: parts.join(''),
    }),
  };
}

// ─── Reading production ─────────────────────────────────────────────────────

function inList(values: readonly string[]): SQL {
  // Each value bound on its own. A JS array bound into raw sql reaches the
  // driver as one comma-joined string (src/lib/db/driver-bind.ts).
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}

export function recentRunsQuery(): SQL {
  return sql`
    select job_type, status::text as status, created_at::text as created_at, error
    from (
      select job_type, status, created_at, error,
        row_number() over (partition by job_type order by id desc) as rn
      from jobs
      where status in ('completed', 'failed')
        and created_at > now() - interval '24 hours'
    ) ranked
    where rn <= 12
  `;
}

export function recentResultsQuery(): SQL {
  return sql`
    select job_type, created_at::text as created_at, payload->'result' as result
    from jobs
    where job_type in (${inList(Object.keys(RESULT_BACKLOG_JOBS))})
      and payload ? 'result'
      and created_at > now() - interval '1 hour'
  `;
}

export function backlogQuery(): SQL {
  return sql`
    select
      (select count(*)::int from orders
        where contacts_read_at is null
          and created_at < now() - interval '1 hour'
          and (last_contacts_fetch_at is null or last_contacts_fetch_at < now() - interval '7 hours')) as contacts_never_read,
      (select min(created_at)::text from orders
        where contacts_read_at is null
          and created_at < now() - interval '1 hour'
          and (last_contacts_fetch_at is null or last_contacts_fetch_at < now() - interval '7 hours')) as contacts_oldest,
      (select count(*)::int from event_outbox
        where published_at is null and fail_count < ${OUTBOX_MAX_FAIL_COUNT}
          and created_at < now() - interval '30 minutes') as outbox_waiting,
      (select min(created_at)::text from event_outbox
        where published_at is null and fail_count < ${OUTBOX_MAX_FAIL_COUNT}
          and created_at < now() - interval '30 minutes') as outbox_oldest,
      (select count(*)::int from jobs
        where job_type = 'titlepoint.poll' and status in ('queued', 'retrying')
          and coalesce(next_retry_at, created_at) < now() - interval '30 minutes') as titlepoint_overdue,
      (select min(created_at)::text from jobs
        where job_type = 'titlepoint.poll' and status in ('queued', 'retrying')
          and coalesce(next_retry_at, created_at) < now() - interval '30 minutes') as titlepoint_oldest
  `;
}

export async function findHealthIssues(now: Date): Promise<HealthIssue[]> {
  const [runRows, resultRows, backlogRows] = await Promise.all([
    db.execute(recentRunsQuery()) as unknown as Promise<Array<Record<string, unknown>>>,
    db.execute(recentResultsQuery()) as unknown as Promise<Array<Record<string, unknown>>>,
    db.execute(backlogQuery()) as unknown as Promise<Array<Record<string, unknown>>>,
  ]);

  const runs: RecentRun[] = runRows.map((r) => ({
    jobType: String(r.job_type),
    status: r.status === 'failed' ? 'failed' : 'completed',
    createdAt: utcDate(String(r.created_at)),
    error: typeof r.error === 'string' ? r.error : null,
  }));
  const results: RecentResult[] = resultRows.map((r) => ({
    jobType: String(r.job_type),
    createdAt: utcDate(String(r.created_at)),
    result: r.result && typeof r.result === 'object' ? r.result as Record<string, unknown> : null,
  }));
  const b = backlogRows[0] ?? {};
  const counts: BacklogCounts = {
    contactsNeverRead: Number(b.contacts_never_read ?? 0),
    contactsOldest: (b.contacts_oldest as string | null) ?? null,
    outboxWaiting: Number(b.outbox_waiting ?? 0),
    outboxOldest: (b.outbox_oldest as string | null) ?? null,
    titlepointOverdue: Number(b.titlepoint_overdue ?? 0),
    titlepointOldest: (b.titlepoint_oldest as string | null) ?? null,
  };

  return [...failingIssues(runs, now), ...resultStallIssues(results, now), ...backlogIssues(counts)];
}

// ─── The check ──────────────────────────────────────────────────────────────

export interface JobHealthCheckResult {
  issues: Array<{ jobType: string; condition: string; summary: string }>;
  opened: number;
  reminded: number;
  resolved: number;
  emailed: boolean;
  recipients: number;
  sendError: string | null;
}

export async function runJobHealthCheck(now: Date = new Date()): Promise<JobHealthCheckResult> {
  const issues = await findHealthIssues(now);
  const openRows = await db
    .select({
      id: jobHealthAlerts.id,
      jobType: jobHealthAlerts.jobType,
      condition: jobHealthAlerts.condition,
      summary: jobHealthAlerts.summary,
      openedAt: jobHealthAlerts.openedAt,
      lastAlertedAt: jobHealthAlerts.lastAlertedAt,
    })
    .from(jobHealthAlerts)
    .where(isNull(jobHealthAlerts.resolvedAt));

  const plan = planHealthAlerts(issues, openRows, now);

  // Record first, so what was seen is kept even if the email fails.
  const opened: OpenAlert[] = [];
  for (const issue of plan.toOpen) {
    const [row] = await db.insert(jobHealthAlerts).values({
      jobType: issue.jobType,
      condition: issue.condition,
      summary: issue.summary,
      detail: issue.detail,
    }).returning({
      id: jobHealthAlerts.id,
      jobType: jobHealthAlerts.jobType,
      condition: jobHealthAlerts.condition,
      summary: jobHealthAlerts.summary,
      openedAt: jobHealthAlerts.openedAt,
      lastAlertedAt: jobHealthAlerts.lastAlertedAt,
    });
    if (row) opened.push(row);
  }
  for (const { alert, issue } of [...plan.toRemind, ...plan.stillOpen]) {
    await db.update(jobHealthAlerts)
      .set({ summary: issue.summary, detail: issue.detail, lastSeenAt: now })
      .where(eq(jobHealthAlerts.id, alert.id));
  }
  for (const alert of plan.toResolve) {
    await db.update(jobHealthAlerts).set({ resolvedAt: now }).where(eq(jobHealthAlerts.id, alert.id));
  }

  const result: JobHealthCheckResult = {
    issues: issues.map(({ jobType, condition, summary }) => ({ jobType, condition, summary })),
    opened: plan.toOpen.length,
    reminded: plan.toRemind.length,
    resolved: plan.toResolve.length,
    emailed: false,
    recipients: 0,
    sendError: null,
  };

  const email = buildJobHealthEmail(plan);
  if (!email) return result;

  const [type] = await db
    .select({ isEnabled: notificationTypes.isEnabled, internalCc: notificationTypes.internalCc })
    .from(notificationTypes)
    .where(eq(notificationTypes.slug, JOB_HEALTH_ALERT_SLUG))
    .limit(1);
  const recipients = (type?.isEnabled ? type.internalCc ?? [] : []).filter((e) => /\S+@\S+\.\S+/.test(e));
  result.recipients = recipients.length;
  if (recipients.length === 0) {
    result.sendError = type ? 'ops.jobs.unhealthy is disabled or has no recipients' : 'ops.jobs.unhealthy notification type is missing';
    return result;
  }

  const sent = await sendEmail({ to: recipients, subject: email.subject, html: email.html });
  if (!sent.success) {
    result.sendError = sent.error?.message ?? 'send failed';
    return result;
  }
  result.emailed = true;

  // Only a delivered alert counts as said. Unsent ones stay due for the next check.
  const said = [...opened, ...plan.toRemind.map(({ alert }) => alert)];
  for (const alert of said) {
    await db.update(jobHealthAlerts)
      .set({ lastAlertedAt: now, alertCount: sql`${jobHealthAlerts.alertCount} + 1` })
      .where(eq(jobHealthAlerts.id, alert.id));
  }
  return result;
}
