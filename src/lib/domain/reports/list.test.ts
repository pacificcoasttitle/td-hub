import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const { captured, rows } = vi.hoisted(() => ({
  captured: [] as unknown[],
  rows: { value: [] as unknown[] },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    execute: vi.fn(async (q: unknown) => { captured.push(q); return rows.value; }),
  },
}));

import { bindLikeTheDriver } from '@/lib/db/driver-bind';
import { REPORT_TYPE_LABELS, listReports, sourceLineFor } from './list';

const text = (q: never) => new PgDialect().sqlToQuery(q).sql;
const lastQuery = () => captured[captured.length - 1] as never;

describe('the Report column sub-line', () => {
  it('says Dataset for the three farming types', () => {
    expect(sourceLineFor('sales_activity', 'generated', null)).toBe('Dataset');
    expect(sourceLineFor('county_sales', 'generated', null)).toBe('Dataset');
  });

  it('says what the money did for Concierge, including when it did nothing', () => {
    expect(sourceLineFor('concierge_profile', 'generated', 1)).toBe('1 credit spent');
    // The first question anyone asks of a failed row.
    expect(sourceLineFor('concierge_profile', 'failed', 0)).toBe('Failed · no credit charged');
    expect(sourceLineFor('concierge_profile', 'failed', 1)).toBe('Failed · 1 credit spent');
  });

  it('says Generating while a profile is still being fetched', () => {
    expect(sourceLineFor('concierge_profile', 'pending', 0)).toBe('Generating');
    expect(sourceLineFor('concierge_profile', 'retrieved', 1)).toBe('Generating');
  });

  it('names all four types', () => {
    expect(Object.values(REPORT_TYPE_LABELS)).toEqual([
      'Sales Activity', 'Carrier Route Analysis', 'County Sales', 'Concierge Profile',
    ]);
  });
});

describe('the union', () => {
  it('selects the same columns from every table, so a fifth type is a migration', async () => {
    captured.length = 0;
    rows.value = [];
    await listReports();
    const sql = text(lastQuery());
    for (const table of ['sales_activity_reports', 'carrier_route_reports', 'county_sales_reports', 'concierge_profiles']) {
      expect(sql).toContain(table);
    }
    expect(sql.match(/list_subject/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('reads the delivery from the log, never a flag on the report row', async () => {
    captured.length = 0;
    await listReports();
    const sql = text(lastQuery());
    expect(sql).toContain('report_deliveries');
    expect(sql).toContain('order by dl.attempted_at desc');
    expect(sql).not.toMatch(/\bsent\b\s*=|is_sent|sent_flag/);
  });

  it('filters to farming without touching the concierge table', async () => {
    captured.length = 0;
    await listReports({ filter: 'farming' });
    const sql = text(lastQuery());
    expect(sql).toContain('sales_activity_reports');
    expect(sql).not.toContain('concierge_profiles');
  });

  it('filters to concierge without touching the farming tables', async () => {
    captured.length = 0;
    await listReports({ filter: 'concierge' });
    const sql = text(lastQuery());
    expect(sql).toContain('concierge_profiles');
    expect(sql).not.toContain('county_sales_reports');
  });

  it('binds the search term instead of interpolating it', async () => {
    captured.length = 0;
    await listReports({ search: "o'brien%" });
    const { params } = new PgDialect().sqlToQuery(lastQuery());
    expect(params).toContain("%o'brien%%");
    expect(text(lastQuery())).not.toContain("o'brien");
  });

  it('binds the way the production driver binds', async () => {
    captured.length = 0;
    await listReports({ page: 3, pageSize: 10, search: 'santa monica' });
    expect(() => bindLikeTheDriver(lastQuery())).not.toThrow();
  });

  it('clamps the page size rather than letting a caller ask for everything', async () => {
    captured.length = 0;
    const r = await listReports({ pageSize: 5000, page: 0 });
    expect(r.pageSize).toBe(100);
    expect(r.page).toBe(1);
  });
});

describe('the address Notify rep will use', () => {
  it('comes from the report row SNAPSHOT, not the contact current email', async () => {
    // The send reads branded_to_email off the report row. The confirmation must
    // show that same address, or the operator confirms one thing and another
    // happens.
    captured.length = 0;
    await listReports();
    const sql = text(lastQuery());
    expect(sql.match(/r\.branded_to_email/g)!.length).toBe(3);
    expect(sql).not.toMatch(/c\.email/);
    expect(sql).toContain('r.presenting_rep_email as branded_to_email');
  });
});

describe('a rep own list', () => {
  it('filters every farming table to the rep contact, and leaves concierge out', async () => {
    captured.length = 0;
    await listReports({ filter: 'farming', forRepContactId: 22140 });
    const q = lastQuery();
    const sql = text(q);
    expect(sql.match(/r\.branded_to_contact_id = \$/g)!.length).toBe(3);
    expect(sql).not.toContain('concierge_profiles');
    expect(new PgDialect().sqlToQuery(q).params).toContain(22140);
  });

  it('applies no rep filter on the operators list', async () => {
    captured.length = 0;
    await listReports();
    expect(text(lastQuery())).not.toMatch(/branded_to_contact_id = \$/);
  });

  it('names who made each report, without letting a repeated email double a row', async () => {
    captured.length = 0;
    await listReports();
    const sql = text(lastQuery());
    expect(sql).toContain('as made_by');
    expect(sql).toMatch(/left join lateral \(\s*select pr\.display_name from profiles pr[\s\S]*limit 1/);
  });
});

describe('the rows it returns', () => {
  it('maps a sent attempt onto the row', async () => {
    captured.length = 0;
    rows.value = [{
      type: 'concierge_profile', id: 7, status: 'generated', credits_charged: 1,
      list_subject: '1358 5th St', list_subject_detail: 'La Verne, CA 91750',
      list_settings: '0.5 mi · 12 mo · ±20% size', branded_to_name: 'Justin Nouri',
      created_at: '2026-09-17 20:14:00', created_by: 'ops@pct.com',
      delivery_outcome: 'sent', delivery_attempted_at: '2026-09-17 20:20:00',
      delivery_recipient_name: 'Justin Nouri', delivery_recipient_email: 'jnouri@pct.com',
    }];
    const r = await listReports();
    expect(r.rows[0]).toMatchObject({
      typeLabel: 'Concierge Profile',
      sourceLine: '1 credit spent',
      subject: '1358 5th St',
      settings: '0.5 mi · 12 mo · ±20% size',
      delivery: { outcome: 'sent', recipientEmail: 'jnouri@pct.com' },
    });
  });

  it('leaves delivery NULL when nothing was ever attempted', async () => {
    captured.length = 0;
    rows.value = [{
      type: 'county_sales', id: 3, status: 'generated', credits_charged: null,
      list_subject: 'Orange County', list_subject_detail: '44 cities', list_settings: 'August 2026',
      branded_to_name: 'Maria Lopez', created_at: '2026-09-16 14:00:00', created_by: 'ops@pct.com',
      delivery_outcome: null, delivery_attempted_at: null,
      delivery_recipient_name: null, delivery_recipient_email: null,
    }];
    const r = await listReports();
    // Never sent must be distinguishable from delivered — that is the whole
    // point of reading the log rather than a boolean.
    expect(r.rows[0]!.delivery).toBeNull();
    expect(r.rows[0]!.sourceLine).toBe('Dataset');
  });
});
