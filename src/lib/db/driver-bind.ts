/**
 * Test support: bind a query's parameters the way the production driver does,
 * without a database.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * A JavaScript `Date` bound into a raw `sql` template does not reach Postgres.
 * `drizzle-orm/postgres-js` replaces postgres.js's timestamp serializers with a
 * pass-through (driver.js `construct`), postgres.js infers type 1184 for any
 * Date (src/types.js `inferType`), and its Bind step writes the value with
 * `Buffer.byteLength` (src/connection.js `Bind`), which throws:
 *
 *   ERR_INVALID_ARG_TYPE: The "string" argument must be of type string or an
 *   instance of Buffer or ArrayBuffer. Received an instance of Date
 *
 * The query builder (`gt(column, date)`) is safe, because the column maps the
 * Date to a string first. Only a Date interpolated into `sql`...`` is not.
 *
 * This broke `notifications.outstanding_documents_alert` twice: fixed on
 * 2026-09-09 (#110) by moving to the builder, reintroduced on 2026-09-16 (#139)
 * by a rewrite back to raw SQL, after which it failed on every run for 14 hours.
 * Neither version had a test that could see it, because the tests mock the
 * database and a mocked `execute` accepts a Date happily.
 *
 * `bindLikeTheDriver` compiles the query with the real dialect, wires a real
 * postgres.js client through the real drizzle constructor (no connection is
 * opened — postgres.js connects lazily), and runs each parameter through that
 * client's serializers and the same byte-length step Bind uses. It throws the
 * driver's own error for exactly the parameters production would reject.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { PgDialect } from 'drizzle-orm/pg-core';
import { SQL } from 'drizzle-orm';
import postgres from 'postgres';

/** postgres.js 3.4 `inferType`, reduced to the cases a bound value can take. */
function inferPostgresJsType(x: unknown): number {
  if (x instanceof Date) return 1184;
  if (x instanceof Uint8Array) return 17;
  if (x === true || x === false) return 16;
  if (typeof x === 'bigint') return 20;
  if (Array.isArray(x)) return inferPostgresJsType(x[0]);
  return 0;
}

let serializers: Record<string, (x: unknown) => unknown> | null = null;

function driverSerializers(): Record<string, (x: unknown) => unknown> {
  if (!serializers) {
    const client = postgres('postgres://bind-check:bind-check@127.0.0.1:1/bind_check', { prepare: false });
    drizzle(client);
    serializers = (client as unknown as { options: { serializers: Record<string, (x: unknown) => unknown> } }).options.serializers;
  }
  return serializers;
}

/** Throws the driver's error if any parameter of `query` cannot be bound. */
export function bindLikeTheDriver(query: SQL): void {
  const { params } = new PgDialect().sqlToQuery(query);
  const table = driverSerializers();
  params.forEach((param) => {
    if (param === null || param === undefined) return;
    const type = inferPostgresJsType(param);
    const bound = type in table ? table[type]!(param) : `${param as string}`;
    Buffer.byteLength(bound as string);
  });
}

/**
 * Every `SQL` object reachable from `value`: a query passed to `execute`, a
 * `where(...)` condition, or the fields object given to `select({...})`.
 */
export function collectSql(value: unknown, out: SQL[] = [], seen = new Set<unknown>()): SQL[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  if (value instanceof SQL) {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) value.forEach((v) => collectSql(v, out, seen));
  else if (Object.getPrototypeOf(value) === Object.prototype) Object.values(value).forEach((v) => collectSql(v, out, seen));
  return out;
}
