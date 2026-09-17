import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('@/lib/integrations/sendgrid/client', () => ({ sendEmail: vi.fn() }));

import { bindLikeTheDriver } from '@/lib/db/driver-bind';
import {
  REMIND_AFTER_HOURS,
  backlogIssues,
  backlogQuery,
  buildJobHealthEmail,
  failingIssues,
  planHealthAlerts,
  recentResultsQuery,
  recentRunsQuery,
  resultStallIssues,
  utcDate,
  type HealthIssue,
  type OpenAlert,
  type RecentRun,
} from './job-health';

const NOW = new Date('2026-09-16T17:36:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const run = (jobType: string, status: 'completed' | 'failed', m: number, error: string | null = null): RecentRun =>
  ({ jobType, status, createdAt: minutesAgo(m), error });

describe('failing — every run fails', () => {
  it('catches the 2026-09-16 outage: an every-2-minute job failing, within six minutes', () => {
    // notifications.outstanding_documents_alert failed from 03:36 UTC for 14
    // hours and 538 runs. Three runs is six minutes.
    const runs = [0, 2, 4].map((m) => run('notifications.outstanding_documents_alert', 'failed', m, 'Failed query: with confirms as'));
    const [issue] = failingIssues(runs, NOW);
    expect(issue).toMatchObject({
      jobType: 'notifications.outstanding_documents_alert',
      condition: 'failing',
      detail: { consecutiveFailures: 3, lastError: 'Failed query: with confirms as' },
    });
    expect(issue!.summary).toBe('Failed 3 runs in a row since 2026-09-16 17:32 UTC.');
  });

  it('catches an hourly job whose last three runs failed, even though an hour holds one run', () => {
    const runs = [5, 65, 125].map((m) => run('softpro.sync_recent_orders', 'failed', m));
    expect(failingIssues(runs, NOW)).toHaveLength(1);
  });

  it('catches every run in the last hour failing, with at least two', () => {
    const runs = [run('softpro.enrich_orders', 'failed', 10), run('softpro.enrich_orders', 'failed', 25), run('softpro.enrich_orders', 'completed', 70)];
    expect(failingIssues(runs, NOW)).toHaveLength(1);
  });

  it('does not alert on an occasional failure', () => {
    const runs = [run('softpro.sync_contacts.lender', 'failed', 5), run('softpro.sync_contacts.lender', 'completed', 185), run('softpro.sync_contacts.lender', 'failed', 365)];
    expect(failingIssues(runs, NOW)).toEqual([]);
  });

  it('does not alert on one failed run in the hour', () => {
    expect(failingIssues([run('ops.daily_report', 'failed', 5)], NOW)).toEqual([]);
  });

  it('ignores queue items, whose individual failures retry by design', () => {
    const runs = [1, 2, 3].map((m) => run('titlepoint.poll', 'failed', m, 'Image still processing'));
    expect(failingIssues(runs, NOW)).toEqual([]);
  });
});

describe('stalled — work waiting that nothing is doing', () => {
  const result = (jobType: string, m: number, r: Record<string, unknown>) => ({ jobType, createdAt: minutesAgo(m), result: r });

  it('flags a job whose every run this hour reported work and did none', () => {
    const [issue] = resultStallIssues([
      result('softpro.enrich_order_details', 5, { eligible: 12, attempted: 0 }),
      result('softpro.enrich_order_details', 20, { eligible: 12, attempted: 0 }),
    ], NOW);
    expect(issue).toMatchObject({ jobType: 'softpro.enrich_order_details', condition: 'stalled', detail: { waiting: 12, runs: 2 } });
  });

  it('does not flag a job that did some of it', () => {
    expect(resultStallIssues([
      result('softpro.fetch_prelims', 5, { total: 44, attempted: 44 }),
      result('softpro.fetch_prelims', 20, { total: 44, attempted: 0 }),
    ], NOW)).toEqual([]);
  });

  it('needs two runs, and ignores results older than an hour', () => {
    expect(resultStallIssues([
      result('sitex.backfill_property', 5, { eligible: 3, attempted: 0 }),
      result('sitex.backfill_property', 90, { eligible: 3, attempted: 0 }),
    ], NOW)).toEqual([]);
  });

  it('turns independent backlog counts into issues, and nothing into nothing', () => {
    const issues = backlogIssues({
      contactsNeverRead: 482, contactsOldest: '2026-08-31 17:13:04',
      outboxWaiting: 1, outboxOldest: '2026-09-16 16:00:00',
      titlepointOverdue: 0, titlepointOldest: null,
    });
    expect(issues.map((i) => [i.jobType, i.condition])).toEqual([
      ['softpro.enrich_orders', 'stalled'],
      ['notifications.process_outbox', 'stalled'],
    ]);
    expect(issues[0]!.summary).toBe('482 orders have never had SoftPro contacts read and are not being attempted.');
    expect(backlogIssues({ contactsNeverRead: 0, contactsOldest: null, outboxWaiting: 0, outboxOldest: null, titlepointOverdue: 0, titlepointOldest: null })).toEqual([]);
  });
});

describe('planHealthAlerts — one alert, reminders, and an all-clear', () => {
  const issue = (jobType: string): HealthIssue => ({ jobType, condition: 'failing', summary: 's', detail: {} });
  const open = (jobType: string, lastAlertedHoursAgo: number | null): OpenAlert => ({
    id: 1, jobType, condition: 'failing', summary: 's', openedAt: minutesAgo(600),
    lastAlertedAt: lastAlertedHoursAgo === null ? null : minutesAgo(lastAlertedHoursAgo * 60),
  });

  it('opens a new condition', () => {
    expect(planHealthAlerts([issue('a')], [], NOW).toOpen).toHaveLength(1);
  });

  it('stays quiet about a condition already alerted recently', () => {
    const plan = planHealthAlerts([issue('a')], [open('a', 1)], NOW);
    expect(plan).toMatchObject({ toOpen: [], toRemind: [], toResolve: [] });
    expect(plan.stillOpen).toHaveLength(1);
  });

  it(`reminds after ${REMIND_AFTER_HOURS} hours`, () => {
    expect(planHealthAlerts([issue('a')], [open('a', REMIND_AFTER_HOURS)], NOW).toRemind).toHaveLength(1);
  });

  it('retries an alert whose email never went out', () => {
    expect(planHealthAlerts([issue('a')], [open('a', null)], NOW).toRemind).toHaveLength(1);
  });

  it('resolves a condition no longer seen', () => {
    expect(planHealthAlerts([], [open('a', 1)], NOW).toResolve).toHaveLength(1);
  });
});

describe('the email', () => {
  it('says nothing when there is nothing to say', () => {
    expect(buildJobHealthEmail({ toOpen: [], toRemind: [], stillOpen: [], toResolve: [] })).toBeNull();
  });

  it('names the job, what is wrong, and the last error — escaped', () => {
    const email = buildJobHealthEmail({
      toOpen: [{ jobType: 'notifications.outstanding_documents_alert', condition: 'failing', summary: 'Failed 3 runs in a row.', detail: { lastError: 'bad <query>' } }],
      toRemind: [], stillOpen: [], toResolve: [],
    })!;
    expect(email.subject).toBe('Background job failing: notifications.outstanding_documents_alert');
    expect(email.html).toContain('Failed 3 runs in a row.');
    expect(email.html).toContain('bad &lt;query&gt;');
  });

  it('sends an all-clear when a condition clears', () => {
    const email = buildJobHealthEmail({
      toOpen: [], toRemind: [], stillOpen: [],
      toResolve: [{ id: 1, jobType: 'softpro.enrich_orders', condition: 'stalled', summary: 's', openedAt: minutesAgo(90), lastAlertedAt: minutesAgo(90) }],
    })!;
    expect(email.subject).toBe('Background job recovered: softpro.enrich_orders');
  });
});

describe('the queries', () => {
  it('bind the way the production driver binds', () => {
    for (const q of [recentRunsQuery(), recentResultsQuery(), backlogQuery()]) {
      expect(() => bindLikeTheDriver(q)).not.toThrow();
    }
  });

  it('binds each watched job type separately — an array would arrive as one joined string', () => {
    const { params } = new PgDialect().sqlToQuery(recentResultsQuery());
    expect(params).toEqual(['softpro.enrich_order_details', 'sitex.backfill_property', 'softpro.fetch_prelims', 'softpro.retry_document_attach']);
  });

  it('reads raw timestamps as UTC', () => {
    expect(utcDate('2026-09-16 03:34:46.275').toISOString()).toBe('2026-09-16T03:34:46.275Z');
  });
});
