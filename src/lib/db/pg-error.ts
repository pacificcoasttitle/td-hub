/**
 * The Postgres error inside whatever was thrown.
 *
 * Drizzle wraps every driver failure in a `DrizzleQueryError` whose message is
 * the failed statement plus its bound parameters, and puts the postgres.js
 * error — the one carrying `code`, `constraint_name`, `column_name`, `detail` —
 * on `cause`. Reading those fields off the thrown object reads the wrapper, and
 * the wrapper has none of them.
 *
 * Two places did exactly that:
 *
 * - `recordCreateLocalFailure` (create-order.ts) was added on 2026-09-09 to
 *   capture why a hub create half-failed. It recorded `code: null`,
 *   `constraint: null`, `column: null` for all ten failures that followed. The
 *   reason — `22001 value too long for type character varying(50)` on
 *   `order_properties.property_type` — was on `cause` every time.
 * - `isUniqueViolation` (enrich-orders.ts) checked `err.code === '23505'`, so
 *   the lost-race convergence it guards never matched and rethrew instead.
 *
 * `describeSyncError` in sync-contacts.ts already knew; this is that knowledge
 * in one place so the next caller does not have to rediscover it.
 */
export interface PgErrorFields {
  code: string | null;
  constraint: string | null;
  column: string | null;
  table: string | null;
  detail: string | null;
  /** The driver's own message ("value too long for …"), not the SQL dump. */
  message: string;
}

type PgErrorish = {
  code?: unknown;
  constraint_name?: unknown;
  column_name?: unknown;
  table_name?: unknown;
  detail?: unknown;
  message?: unknown;
  cause?: unknown;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Walk `cause` until something carries a Postgres SQLSTATE, at most a few levels. */
export function pgErrorFields(err: unknown): PgErrorFields {
  let node: unknown = err;
  for (let depth = 0; depth < 5 && node && typeof node === 'object'; depth++) {
    const e = node as PgErrorish;
    if (str(e.code)) {
      return {
        code: str(e.code),
        constraint: str(e.constraint_name),
        column: str(e.column_name),
        table: str(e.table_name),
        detail: str(e.detail),
        message: str(e.message) ?? String(node),
      };
    }
    node = e.cause;
  }
  const top = err as PgErrorish | null;
  return {
    code: null, constraint: null, column: null, table: null, detail: null,
    message: str(top?.message) ?? String(err),
  };
}

export function isUniqueViolation(err: unknown): boolean {
  return pgErrorFields(err).code === '23505';
}
