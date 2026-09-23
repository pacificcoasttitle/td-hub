import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ─── The half that needs a database ─────────────────────────────────────────
 *
 * A hand-rolled store rather than a mocked `db` that agrees with everything.
 * The questions here — is this event ours, have we seen it before, what does
 * the whole history say now — are answered by data, and a stub that returns
 * whatever the test wants would assert nothing.
 */

interface DeliveryRow { id: number; providerMessageId: string | null; recipientEmail: string; outcome: string; outcomeDetail: string | null }
interface NotificationRow { id: number; providerId: string | null; recipientEmail: string; status: string; errorMessage: string | null }
interface EventRow { id: number; sgMessageId: string; event: string; email: string; occurredAt: Date; reason: string | null; raw: unknown }

const store = vi.hoisted(() => ({
  deliveries: [] as DeliveryRow[],
  notifications: [] as NotificationRow[],
  events: [] as EventRow[],
  seq: 0,
}));

vi.mock('@/lib/db/schema', () => ({
  emailEvents: { __table: 'email_events', sgMessageId: { __col: 'ev.msg' } },
  reportDeliveries: { __table: 'report_deliveries', recipientEmail: { __col: 'rd.email' }, providerMessageId: { __col: 'rd.msg' } },
  notificationLogs: { __table: 'notification_logs', recipientEmail: { __col: 'nl.email' }, providerId: { __col: 'nl.msg' } },
}));

// Captures which table and which predicate, then answers from the arrays above.
// Predicates are structured values built by the drizzle mock below, so the
// store can actually EVALUATE them rather than assume what was meant.
type Pred =
  | { kind: 'in'; col: string; ids: string[] }
  | { kind: 'eq'; col: string; v: string }
  | { kind: 'and'; preds: Pred[] };

const colOf = (c: unknown) => (c as { __col: string }).__col;

function matches(row: Record<string, unknown>, pred: Pred, map: Record<string, string>): boolean {
  if (pred.kind === 'and') return pred.preds.every((p) => matches(row, p, map));
  const field = map[pred.col];
  if (!field) return false;
  const value = row[field];
  if (pred.kind === 'in') return typeof value === 'string' && pred.ids.includes(value);
  // Email comparisons are case-insensitive in the query; mirror that here.
  return typeof value === 'string' && value.toLowerCase() === String(pred.v).toLowerCase();
}

const DELIVERY_COLS = { 'rd.msg': 'providerMessageId', 'rd.email': 'recipientEmail' };
const NOTIFICATION_COLS = { 'nl.msg': 'providerId', 'nl.email': 'recipientEmail' };

vi.mock('@/lib/db/client', () => {
  const table = (t: unknown) => (t as { __table: string }).__table;
  return {
    db: {
      select: () => ({
        from: (t: unknown) => ({
          where: (pred: Pred) => {
            if (table(t) === 'report_deliveries') {
              return Promise.resolve(store.deliveries
                .filter((d) => matches(d as never, pred, DELIVERY_COLS))
                .map((d) => ({ messageId: d.providerMessageId, email: d.recipientEmail })));
            }
            if (table(t) === 'notification_logs') {
              return Promise.resolve(store.notifications
                .filter((n) => matches(n as never, pred, NOTIFICATION_COLS))
                .map((n) => ({ messageId: n.providerId, email: n.recipientEmail })));
            }
            // email_events, looked up by message id alone.
            const id = (pred as { kind: 'eq'; v: string }).v;
            return Promise.resolve(store.events.filter((e) => e.sgMessageId === id));
          },
        }),
      }),
      insert: () => ({
        values: (rows: Omit<EventRow, 'id'>[]) => ({
          onConflictDoNothing: () => ({
            returning: () => {
              const added: { id: number }[] = [];
              for (const r of rows) {
                // The unique index: (message, event, instant).
                const exists = store.events.some((e) => e.sgMessageId === r.sgMessageId
                  && e.event === r.event && e.occurredAt.getTime() === r.occurredAt.getTime());
                if (exists) continue;
                const row = { ...r, id: ++store.seq };
                store.events.push(row);
                added.push({ id: row.id });
              }
              return Promise.resolve(added);
            },
          }),
        }),
      }),
      update: (t: unknown) => ({
        set: (patch: Record<string, string>) => ({
          where: (pred: Pred) => ({
            returning: () => {
              const isDelivery = table(t) === 'report_deliveries';
              const rows = isDelivery ? store.deliveries : store.notifications;
              const map = isDelivery ? DELIVERY_COLS : NOTIFICATION_COLS;
              const hit = rows.filter((r) => matches(r as never, pred, map));
              for (const r of hit) Object.assign(r, patch);
              return Promise.resolve(hit.map((r) => ({ id: r.id })));
            },
          }),
        }),
      }),
    },
  };
});

vi.mock('drizzle-orm', () => ({
  inArray: (col: unknown, ids: string[]): Pred => ({ kind: 'in', col: colOf(col), ids }),
  eq: (col: unknown, v: string): Pred => ({ kind: 'eq', col: colOf(col), v }),
  and: (...preds: Pred[]): Pred => ({ kind: 'and', preds }),
  // raw`lower(${col}) = ${value}` — the column and the value are the two
  // interpolations, in that order.
  sql: (_s: TemplateStringsArray, ...v: unknown[]): Pred => ({ kind: 'eq', col: colOf(v[0]), v: String(v[1]) }),
}));

const { ingestEvents } = await import('./email-events');

const OURS = 'msgOurs123';
const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/** As SendGrid sends it: our id with routing detail appended. */
const event = (o: Partial<{ id: string; event: string; when: string; reason: string; type: string }> = {}) => ({
  sg_message_id: `${o.id ?? OURS}.filterdrecv-abc-1.0`,
  email: 'rep@pct.com',
  event: o.event ?? 'delivered',
  timestamp: at(o.when ?? '2026-09-22T10:00:00Z'),
  ...(o.reason ? { reason: o.reason } : {}),
  ...(o.type ? { type: o.type } : {}),
});

const REP = 'rep@pct.com';

beforeEach(() => {
  store.deliveries = [{ id: 1, providerMessageId: OURS, recipientEmail: REP, outcome: 'sent', outcomeDetail: 'Accepted by SendGrid.' }];
  store.notifications = [];
  store.events = [];
  store.seq = 0;
});

describe('events for mail that is not ours', () => {
  it('drops an event for a message we never sent', async () => {
    // The account carries ~99,900 requests against our ~5,500. Without this
    // filter every number built on this table measures a stranger.
    const r = await ingestEvents([event({ id: 'someoneElsesMail' })]);
    expect(r.unmatched).toBe(1);
    expect(r.kept).toBe(0);
    expect(store.events).toHaveLength(0);
  });

  it('keeps ours and drops theirs from the same batch', async () => {
    const r = await ingestEvents([event(), event({ id: 'notOurs' }), event({ id: 'alsoNotOurs' })]);
    expect(r.kept).toBe(1);
    expect(r.unmatched).toBe(2);
  });

  it('does not touch a delivery row on an unmatched event', async () => {
    await ingestEvents([event({ id: 'notOurs', event: 'bounce' })]);
    expect(store.deliveries[0]!.outcome).toBe('sent');
  });
});

describe('what the person is shown', () => {
  it('earns the word Delivered', async () => {
    const r = await ingestEvents([event({ event: 'delivered' })]);
    expect(r.updated).toBe(1);
    expect(store.deliveries[0]!.outcome).toBe('delivered');
    expect(store.deliveries[0]!.outcomeDetail).toContain('receiving server accepted it');
  });

  it('says plainly that a dropped message did NOT arrive', async () => {
    // The silent case: a suppressed address. SendGrid answers 202 and never
    // tries. Seventeen of these went unnoticed between April and September.
    await ingestEvents([event({ event: 'dropped', reason: 'Bounced Address' })]);
    expect(store.deliveries[0]!.outcome).toBe('dropped');
    expect(store.deliveries[0]!.outcomeDetail).toContain('did NOT receive');
    expect(store.deliveries[0]!.outcomeDetail).toContain('Bounced Address');
  });

  it('keeps the provider\'s reason verbatim on a bounce', async () => {
    await ingestEvents([event({ event: 'bounce', type: 'blocked', reason: '550 5.1.1 User unknown' })]);
    expect(store.deliveries[0]!.outcome).toBe('bounced');
    expect(store.deliveries[0]!.outcomeDetail).toContain('blocked: 550 5.1.1 User unknown');
  });

  it('leaves a deferral alone — it is a retry, not an outcome', async () => {
    const r = await ingestEvents([event({ event: 'deferred', reason: 'greylisted' })]);
    expect(r.kept).toBe(1);        // stored, because it is true
    expect(r.updated).toBe(0);     // but shown to nobody
    expect(store.deliveries[0]!.outcome).toBe('sent');
  });
});

describe('events that arrive late, twice, or out of order', () => {
  it('lets a later spam report overtake an earlier delivery', async () => {
    await ingestEvents([event({ event: 'delivered', when: '2026-09-22T10:00:00Z' })]);
    await ingestEvents([event({ event: 'spamreport', when: '2026-09-23T09:00:00Z' })]);
    expect(store.deliveries[0]!.outcome).toBe('spam');
  });

  it('does NOT let an older event overtake a newer one it arrives after', async () => {
    // Arrival order is not event order. A delivered that HAPPENED first must
    // not overwrite a bounce that happened later, however they turn up.
    await ingestEvents([event({ event: 'bounce', when: '2026-09-22T11:00:00Z', reason: 'rejected' })]);
    await ingestEvents([event({ event: 'delivered', when: '2026-09-22T10:00:00Z' })]);
    expect(store.deliveries[0]!.outcome).toBe('bounced');
  });

  it('counts a retried batch once', async () => {
    const batch = [event({ event: 'delivered' })];
    const first = await ingestEvents(batch);
    const again = await ingestEvents(batch);
    expect(first.kept).toBe(1);
    expect(again.kept).toBe(0);
    expect(again.duplicates).toBe(1);
    expect(store.events).toHaveLength(1);
  });

  it('treats the same event at a different instant as a real second occurrence', async () => {
    await ingestEvents([event({ event: 'deferred', when: '2026-09-22T10:00:00Z' })]);
    await ingestEvents([event({ event: 'deferred', when: '2026-09-22T10:05:00Z' })]);
    expect(store.events).toHaveLength(2);
  });
});

describe('events we cannot use', () => {
  it('counts an event with no message id rather than throwing', async () => {
    const r = await ingestEvents([{ email: 'a@b.com', event: 'delivered', timestamp: at('2026-09-22T10:00:00Z') }]);
    expect(r.unusable).toBe(1);
    expect(r.kept).toBe(0);
  });

  it('counts an event with no timestamp', async () => {
    const r = await ingestEvents([{ sg_message_id: `${OURS}.x`, email: 'a@b.com', event: 'delivered' }]);
    expect(r.unusable).toBe(1);
  });

  it('processes the usable ones alongside the unusable', async () => {
    const r = await ingestEvents([{ event: 'delivered' }, event({ event: 'delivered' })]);
    expect(r.unusable).toBe(1);
    expect(r.kept).toBe(1);
  });

  it('handles an empty batch', async () => {
    expect(await ingestEvents([])).toMatchObject({ received: 0, kept: 0, updated: 0 });
  });
});

describe('the client-facing log, which is where the real mail lives', () => {
  // report_deliveries had ZERO rows in production; all 2,874 client emails —
  // every prelim and confirmation, including all seventeen silent drops — are
  // in notification_logs. A webhook that updated only report_deliveries would
  // have caught none of them and looked like it was working.
  beforeEach(() => {
    store.deliveries = [];
    store.notifications = [
      { id: 10, providerId: OURS, recipientEmail: 'officer@escrow.com', status: 'sent', errorMessage: null },
    ];
  });

  it('marks a prelim that never arrived', async () => {
    const r = await ingestEvents([{
      sg_message_id: `${OURS}.filterdrecv-1.0`, email: 'officer@escrow.com',
      event: 'dropped', reason: 'Bounced Address', timestamp: at('2026-09-22T10:00:00Z'),
    }]);
    expect(r.updated).toBe(1);
    expect(store.notifications[0]!.status).toBe('dropped');
    expect(store.notifications[0]!.errorMessage).toContain('did NOT receive');
  });

  it('earns Delivered here too', async () => {
    await ingestEvents([{
      sg_message_id: `${OURS}.x`, email: 'officer@escrow.com',
      event: 'delivered', timestamp: at('2026-09-22T10:00:00Z'),
    }]);
    expect(store.notifications[0]!.status).toBe('delivered');
  });
});

describe('one message id, eight recipients', () => {
  // A confirmation goes to the escrow officer, both agents and the cc list
  // under ONE message id. SendGrid reports per recipient. Matching on the id
  // alone would stamp one person's bounce onto all eight rows — seven lies
  // for every truth.
  beforeEach(() => {
    store.deliveries = [];
    store.notifications = [
      { id: 1, providerId: OURS, recipientEmail: 'officer@escrow.com', status: 'sent', errorMessage: null },
      { id: 2, providerId: OURS, recipientEmail: 'agent@realty.com', status: 'sent', errorMessage: null },
      { id: 3, providerId: OURS, recipientEmail: 'lender@bank.com', status: 'sent', errorMessage: null },
    ];
  });

  it('bounces ONLY the recipient who bounced', async () => {
    const r = await ingestEvents([{
      sg_message_id: `${OURS}.filterdrecv-1.0`, email: 'agent@realty.com',
      event: 'bounce', reason: '550 5.1.1 User unknown', timestamp: at('2026-09-22T10:00:00Z'),
    }]);
    expect(r.updated).toBe(1);
    expect(store.notifications.find((n) => n.id === 2)!.status).toBe('bounced');
    // The other two are untouched — they did receive it.
    expect(store.notifications.find((n) => n.id === 1)!.status).toBe('sent');
    expect(store.notifications.find((n) => n.id === 3)!.status).toBe('sent');
  });

  it('settles each recipient from its own events', async () => {
    await ingestEvents([
      { sg_message_id: `${OURS}.a`, email: 'officer@escrow.com', event: 'delivered', timestamp: at('2026-09-22T10:00:00Z') },
      { sg_message_id: `${OURS}.b`, email: 'agent@realty.com', event: 'dropped', reason: 'Bounced Address', timestamp: at('2026-09-22T10:00:01Z') },
      { sg_message_id: `${OURS}.c`, email: 'lender@bank.com', event: 'delivered', timestamp: at('2026-09-22T10:00:02Z') },
    ]);
    expect(store.notifications.map((n) => n.status)).toEqual(['delivered', 'dropped', 'delivered']);
  });

  it('ignores an event for an address that was not on this message', async () => {
    const r = await ingestEvents([{
      sg_message_id: `${OURS}.x`, email: 'stranger@elsewhere.com',
      event: 'bounce', timestamp: at('2026-09-22T10:00:00Z'),
    }]);
    expect(r.unmatched).toBe(1);
    expect(store.notifications.every((n) => n.status === 'sent')).toBe(true);
  });
});
