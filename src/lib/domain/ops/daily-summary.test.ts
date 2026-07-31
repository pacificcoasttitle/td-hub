import { describe, expect, it } from 'vitest';
import { composeAttention, friendlyJobName, withTimeout } from './daily-summary';
import { buildHeadline, buildSubject, renderDailySummaryText } from './daily-summary-email';
import type { DailySummary } from './daily-summary';

const ok = <T>(data: T) => ({ ok: true as const, data });
const bad = (error: string) => ({ ok: false as const, error });

const CLEAN = {
  orderFlow: ok({ newlyStuckOver6Hours: 0 }),
  notifications: ok({ confirmationMissingClient: 0, confirmationNoRecipients: 0 }),
  emails: ok({ sent: 47, failed: 0 }),
  syncHealth: ok({ rows: [{ jobType: 'softpro.enrich_orders', failed: 0 }] }),
  vendorApiHealth: ok({ rows: [{ vendor: 'softpro', successRate: 99.8, calls: 400 }] }),
  cpls: ok({ failedByVendor: [] }),
};

describe('composeAttention', () => {
  it('says nothing when nothing is wrong', () => {
    expect(composeAttention(CLEAN)).toEqual([]);
  });

  it('leads with a client who did not get their confirmation', () => {
    const out = composeAttention({
      ...CLEAN,
      notifications: ok({ confirmationMissingClient: 1, confirmationNoRecipients: 0 }),
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('went out without reaching the client');
    expect(out[0]).toContain('forward it manually');
  });

  it('pluralises correctly', () => {
    const one = composeAttention({
      ...CLEAN,
      orderFlow: ok({ newlyStuckOver6Hours: 1 }),
    })[0];
    const many = composeAttention({
      ...CLEAN,
      orderFlow: ok({ newlyStuckOver6Hours: 3 }),
    })[0];
    expect(one).toContain('1 order has been waiting');
    expect(one).toContain('It arrived');
    expect(many).toContain('3 orders have been waiting');
    expect(many).toContain('They arrived');
  });

  it('translates job names instead of printing them raw', () => {
    const out = composeAttention({
      ...CLEAN,
      syncHealth: ok({ rows: [{ jobType: 'softpro.sync_contacts.selling_agent_broker', failed: 2 }] }),
    });
    expect(out[0]).toContain('contact sync (2)');
    expect(out[0]).not.toContain('softpro.sync_contacts');
  });

  it('only flags a vendor with enough volume to be meaningful', () => {
    const lowVolume = composeAttention({
      ...CLEAN,
      vendorApiHealth: ok({ rows: [{ vendor: 'titlepoint', successRate: 50, calls: 4 }] }),
    });
    expect(lowVolume).toEqual([]);

    const realProblem = composeAttention({
      ...CLEAN,
      vendorApiHealth: ok({ rows: [{ vendor: 'titlepoint', successRate: 88, calls: 200 }] }),
    });
    expect(realProblem[0]).toContain('TitlePoint was unreliable');
    expect(realProblem[0]).toContain('12%');
  });

  it('reports CPL failures per vendor', () => {
    const out = composeAttention({
      ...CLEAN,
      cpls: ok({ failedByVendor: [{ vendor: 'westcor', count: 2 }] }),
    });
    expect(out[0]).toBe('2 CPL documents could not be generated through westcor.');
  });

  it('stays quiet about sections it could not read', () => {
    expect(composeAttention({
      orderFlow: bad('timed out'),
      notifications: bad('timed out'),
      emails: bad('timed out'),
      syncHealth: bad('timed out'),
      vendorApiHealth: bad('timed out'),
      cpls: bad('timed out'),
    })).toEqual([]);
  });
});

describe('friendlyJobName', () => {
  it('maps known jobs to plain words', () => {
    expect(friendlyJobName('notifications.process_outbox')).toBe('email queue');
    expect(friendlyJobName('softpro.sync_contacts.lender')).toBe('contact sync');
    expect(friendlyJobName('titlepoint.drain')).toBe('title data lookup');
  });
  it('degrades an unknown job to something readable', () => {
    expect(friendlyJobName('some.new_job')).toBe('some new job');
  });
});

describe('withTimeout', () => {
  it('passes through a result that arrives in time', async () => {
    const res = await withTimeout('X', Promise.resolve(ok({ a: 1 })), 1000);
    expect(res).toEqual({ ok: true, data: { a: 1 } });
  });

  it('returns an unavailable result instead of hanging', async () => {
    const never = new Promise<never>(() => {});
    const res = await withTimeout('Orders', never as never, 20);
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toContain('Orders timed out');
  });

  it('catches a rejection rather than propagating it', async () => {
    const res = await withTimeout('X', Promise.reject(new Error('boom')), 1000);
    expect(res).toEqual({ ok: false, error: 'boom' });
  });
});

function summary(attention: string[], complete = true): DailySummary {
  return {
    dayLabel: 'Thursday, July 30',
    window: { start: new Date(), end: new Date(), ymd: { year: 2026, month: 7, day: 30 } },
    generatedAt: new Date(),
    attention,
    numbers: {
      ordersFromSoftPro: 12, ordersCreatedHere: 2, prelimsDelivered: 8,
      prelimsSummarised: 3, cplsGenerated: 15, emailsSent: 47, emailsFailed: 0,
    },
    complete,
    unavailable: complete ? [] : ['Emails'],
  };
}

describe('subject and headline', () => {
  it('says all clear when there is nothing to do', () => {
    expect(buildSubject(summary([]))).toBe('TD Hub — all clear · Thursday, July 30');
    expect(buildHeadline(summary([]))).toBe('Everything ran clean yesterday.');
  });

  it('counts the things needing attention, singular', () => {
    expect(buildSubject(summary(['a']))).toBe('TD Hub — 1 thing needs attention · Thursday, July 30');
    expect(buildHeadline(summary(['a']))).toBe('1 thing needs your attention.');
  });

  it('counts the things needing attention, plural', () => {
    expect(buildSubject(summary(['a', 'b']))).toBe('TD Hub — 2 things need attention · Thursday, July 30');
    expect(buildHeadline(summary(['a', 'b']))).toBe('2 things need your attention.');
  });
});

describe('regressions found against real data', () => {
  it('merges job types that share a friendly name instead of repeating it', () => {
    const out = composeAttention({
      ...CLEAN,
      syncHealth: ok({ rows: [
        { jobType: 'softpro.enrich_orders', failed: 3 },
        { jobType: 'softpro.enrich_order_details', failed: 1 },
        { jobType: 'softpro.sync_contacts.lender', failed: 1 },
      ] }),
    });
    expect(out[0]).toContain('order detail lookup (4)');
    expect(out[0]).not.toMatch(/order detail lookup.*order detail lookup/);
  });

  it('orders the failing jobs worst-first', () => {
    const out = composeAttention({
      ...CLEAN,
      syncHealth: ok({ rows: [
        { jobType: 'softpro.sync_contacts.lender', failed: 1 },
        { jobType: 'softpro.enrich_orders', failed: 5 },
      ] }),
    });
    expect(out[0].indexOf('order detail lookup')).toBeLessThan(out[0].indexOf('contact sync'));
  });
});

describe('number lines never read nonsensically', () => {
  it('does not say "0 sent, all delivered" on a quiet day', () => {
    const s = summary([]);
    s.numbers.emailsSent = 0;
    s.numbers.emailsFailed = 0;
    const text = renderDailySummaryText(s, 'x');
    expect(text).toContain('Emails — none went out');
    expect(text).not.toContain('0 sent, all delivered');
  });

  it('still reports failures when nothing was delivered', () => {
    const s = summary([]);
    s.numbers.emailsSent = 0;
    s.numbers.emailsFailed = 2;
    expect(renderDailySummaryText(s, 'x')).toContain('Emails — 0 sent, 2 failed');
  });
});

describe('email counts come from actual sends, not the outbox table', () => {
  it('reports emails that SendGrid actually sent', () => {
    const s = summary([]);
    s.numbers.emailsSent = 38;
    s.numbers.emailsFailed = 0;
    expect(renderDailySummaryText(s, 'x')).toContain('Emails — 38 sent, all delivered');
  });

  it('raises failures from the send log', () => {
    const out = composeAttention({ ...CLEAN, emails: ok({ sent: 30, failed: 2 }) });
    expect(out).toContain('2 emails failed to send.');
  });

  it('says nothing about email when the send log is unreadable', () => {
    expect(composeAttention({ ...CLEAN, emails: bad('timed out') })).toEqual([]);
  });
});
