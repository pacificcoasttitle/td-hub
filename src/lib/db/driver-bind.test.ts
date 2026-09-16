import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gt, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

// Every query these code paths build is captured from a recording `db`, then
// bound the way production binds it. A mocked `execute` accepts a Date without
// complaint, which is how #139 walked straight over the #110 fix: the only
// check that can see this defect is one that runs the parameters through the
// driver's own serializers.

const { captured, rows, db } = vi.hoisted(() => {
  const captured: unknown[] = [];
  const rows: { value: unknown[] } = { value: [] };
  // Any chain — db.select(...).from(...).where(...), db.execute(...) — records
  // its arguments and resolves to no rows when awaited.
  const handler: ProxyHandler<(...args: unknown[]) => unknown> = {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (result: unknown[]) => void) => resolve(rows.value);
      return proxy;
    },
    apply(_target, _this, args) {
      captured.push(args);
      return proxy;
    },
  };
  const proxy: unknown = new Proxy(function chain() {}, handler);
  return { captured, rows, db: proxy };
});

vi.mock('@/lib/db/client', () => ({ db }));
vi.mock('@/lib/security/auth', () => ({ getSession: vi.fn(async () => ({ role: 'admin' })) }));
vi.mock('@/lib/domain/notifications/dispatch', () => ({ dispatchNotification: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = vi.fn(async () => ({})); },
  HeadBucketCommand: class {},
}));

import { bindLikeTheDriver, collectSql } from './driver-bind';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { notificationLogs, prelimAnalyses } from './schema';

const text = (q: ReturnType<typeof collectSql>[number]) => new PgDialect().sqlToQuery(q).sql;

function bindEverything() {
  const queries = collectSql(captured);
  for (const q of queries) bindLikeTheDriver(q);
  return queries;
}

describe('bindLikeTheDriver sees what production sees', () => {
  it('rejects a Date interpolated into raw sql — the defect itself', () => {
    expect(() => bindLikeTheDriver(sql`select 1 where now() > ${new Date()}`))
      .toThrow(/Received an instance of Date/);
  });

  it('accepts the same instant as a string', () => {
    expect(() => bindLikeTheDriver(sql`select 1 where now() > ${new Date().toISOString()}`)).not.toThrow();
  });

  it('accepts a Date given to the query builder, which maps it through the column', () => {
    expect(() => bindLikeTheDriver(gt(notificationLogs.sentAt, new Date()) as never)).not.toThrow();
  });
});

describe('queries that bound a Date into raw sql', () => {
  beforeEach(() => {
    captured.length = 0;
    rows.value = [];
  });

  it('notifications.outstanding_documents_alert: the scan binds (#110, reverted by #139)', async () => {
    const { handleOutstandingDocumentsAlert } = await import('@/lib/jobs/handlers/outstanding-documents-alert');

    await handleOutstandingDocumentsAlert();

    const queries = bindEverything();
    expect(queries.some((q) => text(q).includes('with confirms as'))).toBe(true);
  });

  it('notifications.outstanding_documents_alert: the pending count binds', async () => {
    const { countPendingOutstandingAlerts } = await import('@/lib/jobs/handlers/outstanding-documents-alert');

    await countPendingOutstandingAlerts();

    const queries = bindEverything();
    expect(queries.some((q) => text(q).includes('first_search_after'))).toBe(true);
  });

  it('GET /api/admin/ops/notifications: the email and SMS month counts bind', async () => {
    const { GET } = await import('@/app/api/admin/ops/notifications/route');

    await GET({ nextUrl: new URL('https://hub.test/api/admin/ops/notifications') } as never);

    const queries = bindEverything();
    expect(queries.filter((q) => text(q).includes('"channel" = \'email\'') || text(q).includes('"channel" = \'sms\''))).toHaveLength(2);
  });

  it('GET /api/health/tessa: the 24-hour success and failure counts bind', async () => {
    // The route first checks the live columns of prelim_analyses and stops if
    // any are missing; answer that with the schema's own columns so it runs on.
    rows.value = getTableConfig(prelimAnalyses).columns.map((c) => ({ column_name: c.name }));
    const { GET } = await import('@/app/api/health/tessa/route');

    await GET();

    const queries = bindEverything();
    expect(queries.filter((q) => text(q).includes('"prelim_analyses"."created_at" >= $1)'))).toHaveLength(2);
  });
});
