/**
 * DRIFT GUARD, layer 1 of 2. Runs in CI's `app` job via `npm test`, on every
 * push and PR, with NO database credentials.
 *
 * WHAT IT GUARDS AGAINST
 *   0032 enabled RLS on 37 tables by hand-written name. Five tables added later
 *   were pushed straight from the Drizzle schema with `drizzle-kit push`, never
 *   passed through a migration file, and so were never added to that list. They
 *   sat world-readable behind a browser-reachable anon key until 0038. The five
 *   ALTER TABLEs in 0038 do not stop a sixth table doing the same thing. This
 *   does: a table added to the Drizzle schema with no matching
 *   `ENABLE ROW LEVEL SECURITY` fails here, in a check a human sees on the PR.
 *
 * WHY IT PARSES FILES INSTEAD OF IMPORTING THE SCHEMA
 *   It deliberately does not go through src/lib/db/schema/index.ts, because
 *   index.ts has itself drifted: concierge.ts is not re-exported from it, which
 *   is part of how three of the five stayed invisible. A guard that trusted the
 *   barrel file would have had the same blind spot as the thing it guards.
 *
 * WHAT IT CANNOT DETECT — read this before trusting it
 *   1. Whether the migration was ever APPLIED. Migrations here are hand-applied
 *      and there is no runner, so "0038 exists in git" and "RLS is on in
 *      production" are different facts. This check can only see the first.
 *   2. A table created directly in the database and never added to the Drizzle
 *      schema. It is invisible to a source-only check by construction.
 *   3. Whether the GRANTs to anon/authenticated were narrowed. RLS is what
 *      denies; the grants are a separate, still-open item.
 *   Layer 2, `npm run db:verify-rls`, closes 1 and 2 and reports 3 — but it
 *   needs DATABASE_URL and so cannot run in CI. It refuses to exit 0 without
 *   credentials rather than skipping.
 *
 * HOW IT FAILS
 *   Loudly, and it cannot fail silent. If the regexes ever stop matching, the
 *   "parsed everything we found" assertions below fail rather than reporting an
 *   empty set as clean. That is the whole point: a guard whose failure mode is
 *   silence is the same defect as the drift it watches for.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(HERE, 'schema');
const MIGRATIONS_DIR = join(HERE, 'migrations');

/** Tables we know must exist. If these vanish, the parse broke — not the schema. */
const ANCHORS = ['orders', 'contacts', 'party_wizard_links', 'concierge_profiles'];

function readAll(dir: string, ext: string): { file: string; body: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => ({ file: f, body: readFileSync(join(dir, f), 'utf8') }));
}

/** Comments and DO blocks are not the auditable record of intent; strip them. */
function stripNoise(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/DO\s+\$\$[\s\S]*?\$\$/gi, '');
}

interface SchemaTables {
  names: Set<string>;
  byFile: Map<string, string[]>;
  looseCount: number;
}

function drizzleTables(): SchemaTables {
  const names = new Set<string>();
  const byFile = new Map<string, string[]>();
  let looseCount = 0;

  for (const { file, body } of readAll(SCHEMA_DIR, '.ts')) {
    if (file.endsWith('.test.ts')) continue;
    looseCount += (body.match(/\bpgTable\s*\(/g) ?? []).length;
    const found: string[] = [];
    for (const m of body.matchAll(/\bpgTable\s*\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) {
      names.add(m[1]);
      found.push(m[1]);
    }
    if (found.length) byFile.set(file, found);
  }
  return { names, byFile, looseCount };
}

interface RlsCoverage {
  /** Tables whose LAST RLS statement across all migrations was ENABLE. */
  enabled: Set<string>;
  /** Tables explicitly DISABLEd and never re-enabled. */
  disabled: Set<string>;
  forced: string[];
  looseEnableCount: number;
  strictEnableCount: number;
}

function rlsCoverage(): RlsCoverage {
  const finalState = new Map<string, boolean>();
  const forced: string[] = [];
  let looseEnableCount = 0;
  let strictEnableCount = 0;

  // Sorted filenames = apply order. Migration numbers are a manual convention
  // here, but they are zero-padded, so lexical order is apply order.
  for (const { body } of readAll(MIGRATIONS_DIR, '.sql')) {
    const sql = stripNoise(body);
    looseEnableCount += (sql.match(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi) ?? []).length;

    const statement = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\s*\.\s*)?"?([a-zA-Z0-9_]+)"?\s+(NO\s+FORCE|FORCE|ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY/gi;
    for (const m of sql.matchAll(statement)) {
      const table = m[1];
      const verb = m[2].toUpperCase().replace(/\s+/g, ' ');
      if (verb === 'ENABLE') { finalState.set(table, true); strictEnableCount += 1; }
      else if (verb === 'DISABLE') finalState.set(table, false);
      else if (verb === 'FORCE') forced.push(table);
    }
  }

  const enabled = new Set<string>();
  const disabled = new Set<string>();
  for (const [t, on] of finalState) (on ? enabled : disabled).add(t);
  return { enabled, disabled, forced, looseEnableCount, strictEnableCount };
}

describe('RLS lockdown coverage', () => {
  const schema = drizzleTables();
  const rls = rlsCoverage();

  // ── Anti-silence. These exist so a broken parse fails instead of passing. ──

  it('parsed every pgTable() call it found in the schema directory', () => {
    expect(schema.looseCount).toBeGreaterThan(0);
    expect(schema.names.size).toBe(schema.looseCount);
  });

  it('found the tables it knows must be there', () => {
    for (const a of ANCHORS) expect([...schema.names]).toContain(a);
  });

  it('parsed every ENABLE ROW LEVEL SECURITY statement it found in migrations', () => {
    expect(rls.looseEnableCount).toBeGreaterThan(0);
    expect(rls.strictEnableCount).toBe(rls.looseEnableCount);
  });

  // ── The actual guard. ──

  it('every table in the Drizzle schema has RLS enabled by a migration', () => {
    const uncovered = [...schema.names].filter((t) => !rls.enabled.has(t)).sort();

    expect(
      uncovered,
      uncovered.length === 0 ? '' : [
        '',
        `${uncovered.length} table(s) in the Drizzle schema have no ENABLE ROW LEVEL SECURITY`,
        'in any migration:',
        ...uncovered.map((t) => `  - ${t}   (declared in ${
          [...schema.byFile].find(([, ts]) => ts.includes(t))?.[0] ?? 'unknown file'})`),
        '',
        'This is the drift that left five tables world-readable behind the public',
        'anon key until migration 0038. Do not silence this test. Instead:',
        '',
        '  1. Add a migration with the next number, e.g.',
        `       ALTER TABLE public.${uncovered[0]} ENABLE ROW LEVEL SECURITY;`,
        '     Do NOT add FORCE — the app connects as the table owner and relies on',
        '     the owner bypass. Do NOT add a policy unless there is a real caller',
        '     to test it against.',
        '  2. Apply it by hand. There is no migration runner in this repo, so',
        '     merging the file changes nothing in production on its own.',
        '  3. Confirm with: npm run db:verify-rls   (needs DATABASE_URL)',
        '',
      ].join('\n'),
    ).toEqual([]);
  });

  it('no migration leaves a table with RLS explicitly disabled', () => {
    expect([...rls.disabled].sort()).toEqual([]);
  });

  it('no migration sets FORCE ROW LEVEL SECURITY', () => {
    // FORCE applies policies to the table owner. The app IS the owner of every
    // public table and there are no policies, so FORCE plus no policy would deny
    // the application itself. Measured 2026-08-27: BYPASSRLS still wins over
    // FORCE for this role, so it would not break today — but that is one role
    // attribute away from an outage and nothing here needs it.
    expect(rls.forced).toEqual([]);
  });

  it('names no table in a lockdown migration that the schema does not declare', () => {
    // A stale name means either a dropped table or a typo, and a typo'd
    // ALTER TABLE is a table that was never actually closed.
    const unknown = [...rls.enabled].filter((t) => !schema.names.has(t)).sort();
    expect(unknown, unknown.length === 0 ? '' : [
      '',
      'These tables are named in an ENABLE ROW LEVEL SECURITY statement but do not',
      'exist in the Drizzle schema:',
      ...unknown.map((t) => `  - ${t}`),
      'Either the table was dropped (fine — remove it from this expectation by',
      'dropping it from the schema too) or the name is misspelled, in which case',
      'the real table was never closed.',
      '',
    ].join('\n')).toEqual([]);
  });
});
