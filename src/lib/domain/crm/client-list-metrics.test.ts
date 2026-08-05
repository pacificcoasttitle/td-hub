import { describe, expect, it } from 'vitest';
import { bucketOrdersByMonth, composeClientMetrics } from './clients';
import { deriveSignal } from './client-signals';
import type { ClientOrderRow } from './client-metrics';

const NOW = new Date('2026-08-03T12:00:00Z');
const d = (s: string) => new Date(`${s}T12:00:00Z`);

function link(orderId: number, contactId: number, salesRepId: number, opened: string, status = 'closed') {
  return {
    orderId,
    salesRepId,
    contactId,
    openedAt: d(opened),
    closedAt: null,
    operationalStatus: status,
  };
}

// ─── The bulk list path must not change who is in the list ──────────────────

describe('composeClientMetrics — display enrichment only', () => {
  it('returns exactly one entry per client handed in, no more and no fewer', () => {
    const clients = [
      { id: 1, contactId: 500, ownerContactId: 10 },
      { id: 2, contactId: null, ownerContactId: 10 },   // unlinked
      { id: 3, contactId: 900, ownerContactId: null },  // no rep contact
    ];
    const m = composeClientMetrics(clients, [link(1, 500, 10, '2026-07-01')], NOW);

    // Membership is the caller's, never this function's.
    expect([...m.keys()].sort()).toEqual([1, 2, 3]);
    expect(m.get(2)!.unlinked).toBe(true);
    expect(m.get(3)!.counts.total).toBe(0);
  });

  it('scopes orders to the client’s OWNER rep, not whoever is looking', () => {
    const m = composeClientMetrics(
      [{ id: 1, contactId: 500, ownerContactId: 10 }],
      [link(1, 500, 10, '2026-07-01'), link(2, 500, 99, '2026-07-02')],
      NOW,
    );
    expect(m.get(1)!.counts.total).toBe(1);
  });

  it('dedupes an order reached through both link paths', () => {
    const m = composeClientMetrics(
      [{ id: 1, contactId: 500, ownerContactId: 10 }],
      [link(7, 500, 10, '2026-07-01'), link(7, 500, 10, '2026-07-01')],
      NOW,
    );
    expect(m.get(1)!.counts.total).toBe(1);
  });

  it('gives two rows for the same firm two independent snapshots', () => {
    // The identity guarantee from PR #14, held on the bulk list path too.
    const m = composeClientMetrics(
      [
        { id: 501, contactId: 8366, ownerContactId: 10 },
        { id: 502, contactId: 8365, ownerContactId: 10 },
      ],
      [
        link(1, 8366, 10, '2026-07-01'), link(2, 8366, 10, '2026-06-01'),
        link(3, 8365, 10, '2026-05-01'),
      ],
      NOW,
    );
    expect(m.get(501)!.counts.total).toBe(2);
    expect(m.get(502)!.counts.total).toBe(1);
    expect(m.get(501)!.contactId).toBe(8366);
    expect(m.get(502)!.contactId).toBe(8365);
  });

  it('feeds the row chip without a second query', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      link(i + 1, 500, 10, new Date(NOW.getTime() - (60 + i * 6) * 86_400_000).toISOString().slice(0, 10)));
    const m = composeClientMetrics([{ id: 1, contactId: 500, ownerContactId: 10 }], rows, NOW);
    const signal = deriveSignal(m.get(1)!);
    expect(['quiet', 'declining', 'steady', 'momentum']).toContain(signal.kind);
  });
});

// ─── Orders by month ────────────────────────────────────────────────────────

describe('bucketOrdersByMonth', () => {
  const rows: ClientOrderRow[] = [
    { orderId: 1, openedAt: d('2026-08-01'), closedAt: null, operationalStatus: 'open' },
    { orderId: 2, openedAt: d('2026-07-15'), closedAt: null, operationalStatus: 'closed' },
    { orderId: 3, openedAt: d('2026-07-02'), closedAt: null, operationalStatus: 'closed' },
  ];

  it('returns the requested number of months, oldest first', () => {
    const b = bucketOrdersByMonth(rows, 12, NOW);
    expect(b).toHaveLength(12);
    expect(b[11]!.month).toBe('2026-08');
    expect(b[10]!.month).toBe('2026-07');
  });

  it('counts orders into their calendar month', () => {
    const b = bucketOrdersByMonth(rows, 12, NOW);
    expect(b.find(x => x.month === '2026-08')!.orders).toBe(1);
    expect(b.find(x => x.month === '2026-07')!.orders).toBe(2);
  });

  it('keeps empty months as zero so a gap stays visible', () => {
    const b = bucketOrdersByMonth(rows, 12, NOW);
    expect(b.find(x => x.month === '2026-06')!.orders).toBe(0);
    expect(b.every(x => typeof x.orders === 'number')).toBe(true);
  });

  it('ignores orders older than the window rather than piling them on the edge', () => {
    const withOld = [...rows, { orderId: 9, openedAt: d('2024-01-05'), closedAt: null, operationalStatus: 'closed' }];
    const b = bucketOrdersByMonth(withOld, 12, NOW);
    expect(b.reduce((s, x) => s + x.orders, 0)).toBe(3);
  });

  it('dedupes by order id', () => {
    const dup = [rows[0]!, { ...rows[0]! }];
    expect(bucketOrdersByMonth(dup, 12, NOW).reduce((s, x) => s + x.orders, 0)).toBe(1);
  });

  it('is unaffected by operational_status', () => {
    const asOpen = rows.map(r => ({ ...r, operationalStatus: 'in_process' }));
    expect(bucketOrdersByMonth(asOpen, 12, NOW)).toEqual(bucketOrdersByMonth(rows, 12, NOW));
  });
});
