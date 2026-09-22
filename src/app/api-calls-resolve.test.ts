import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// ─── Every API call in the UI must have somewhere to land ───────────────────
//
// Two of the four unreachable pages found on 2026-09-18 were not merely
// unlinked: they were built against endpoints that were never written.
// /sales/commission fetched /api/sales/commission and /sales/reports fetched
// /api/sales/reports; both 404ed, and both pages caught the 404 and showed
// "coming soon" — so nothing failed, nothing logged, and for five months each
// looked like unfinished work rather than a broken promise.
//
// The navigation test cannot see this. A page can be linked, visible and
// reachable, and still call nothing. This asks the other question: every
// literal '/api/…' in the application source must resolve to a route file.
//
// WHAT COUNTS AS A CALL. Any string or template literal that starts with
// /api/ — fetch('/api/x'), fetchUrl="/api/x", `/api/x/${id}` — outside tests
// and outside the API routes themselves. Template interpolations stand for one
// path segment, and match a [dynamic] segment in the route tree.

const SRC = join(process.cwd(), 'src');
const API_DIR = join(SRC, 'app', 'api');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every API route, as a list of segments. `[id]` and `[...slug]` are kept as written. */
const routes: string[][] = walk(API_DIR)
  .filter((f) => /[\\/]route\.ts$/.test(f))
  .map((f) => relative(API_DIR, f).replace(/\\/g, '/').replace(/\/?route\.ts$/, ''))
  .map((r) => (r === '' ? [] : r.split('/')));

/**
 * `isClient ? '/api/client' : '/api'` — a base, completed by concatenation
 * elsewhere. Counted as resolved when real routes live under it. A dead FULL
 * path is still caught; only an incomplete one gets the benefit of the doubt.
 */
function isBaseOfRealRoutes(segments: string[]): boolean {
  return segments.length > 0
    && !segments.includes('*')
    && routes.some((r) => r.length > segments.length && segments.every((s, i) => r[i] === s));
}

function resolves(segments: string[]): boolean {
  return routes.some((route) => {
    for (let i = 0; i < route.length; i++) {
      const r = route[i]!;
      if (r.startsWith('[...') || r.startsWith('[[...')) return segments.length >= i;
      const s = segments[i];
      if (s === undefined) return false;
      if (r.startsWith('[')) continue;          // a dynamic segment matches anything
      if (s === '*') return false;              // an interpolation cannot equal a literal
      if (r !== s) return false;
    }
    return segments.length === route.length;
  });
}

/**
 * '/api/sales/reports?x=1' → ['sales', 'reports'].
 * `/x/${id}` → ['x', '*']: an interpolation that IS a segment stands for one.
 * `/trends${params}` → ['trends']: one glued onto a segment is a suffix — in
 * practice a query string built elsewhere — not a segment of its own.
 */
function toSegments(path: string): string[] {
  return path
    .replace(/\/\$\{[^}]*\}/g, '/*')
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/[?#].*$/, '')
    .replace(/^\/api\/?/, '')
    .replace(/\/$/, '')
    .split('/')
    .filter(Boolean);
}

interface Call { file: string; path: string }

function apiCalls(): Call[] {
  const calls: Call[] = [];
  const files = walk(SRC).filter((f) => /\.tsx?$/.test(f)
    && !/\.test\.tsx?$/.test(f)
    && !f.startsWith(API_DIR)
    // Matches request paths; calls nothing.
    && !/[\\/]middleware\.ts$/.test(f)
    // Clients for OTHER services, whose paths happen to start /api/ too —
    // the managers-report API, for one. Not our routes to resolve.
    && !f.includes(`${join('lib', 'integrations')}`));
  const re = /(['"`])(\/api\/[^'"`\s]*?)\1/g;
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(re)) {
      calls.push({ file: relative(SRC, file).replace(/\\/g, '/'), path: m[2]! });
    }
  }
  return calls;
}

/**
 * Calls to endpoints that do not exist yet, each with the reason it is allowed
 * to stay. Anything else unresolved fails the build.
 */
const AWAITING_THEIR_ENDPOINT = new Set([
  // ── Planned: the route arrives with work already on the list ──────────────

  // The sales rep's view of the Reports page. Kept by decision on 2026-09-21
  // as the destination for that work.
  '/api/sales/reports',

  // ── Deliberately kept: shelved, not dead ─────────────────────────────────

  // Tessa chat and prelim analysis. Imported by nothing today, and the
  // endpoints were never written — but Gerard is SHELVING Tessa until he
  // decides what it should do, not abandoning it (2026-09-21). Recorded here
  // so this check does not flag it, and so nobody deletes it later on the
  // assumption that unused means dead.
  '/api/tessa/chat',
  '/api/tessa/analyze',

  // Removed 2026-09-21 rather than listed: the Job Log "Document Activity" tab
  // (/api/logs/documents) and the title officer "Pending Tasks" panel
  // (/api/dashboard/title-officer/pending). Both turned a 404 into an empty
  // state that read as "nothing here" — the second one in green, as "All
  // caught up!".
]);

describe('every API call in the application resolves to a route', () => {
  const calls = apiCalls();

  it('finds the calls at all', () => {
    // A regex that silently matched nothing would pass forever.
    expect(calls.length).toBeGreaterThan(50);
    expect(calls.some((c) => c.path.startsWith('/api/reports?'))).toBe(true);
  });

  it('resolves every one, or names why not', () => {
    const dead = calls
      .filter((c) => !AWAITING_THEIR_ENDPOINT.has(c.path.replace(/[?#].*$/, '')))
      .filter((c) => !resolves(toSegments(c.path)) && !isBaseOfRealRoutes(toSegments(c.path)))
      .map((c) => `${c.file}  →  ${c.path}`);
    expect(dead, 'UI code calling an endpoint with no route file. Build the route, remove the '
      + 'call, or add it to AWAITING_THEIR_ENDPOINT with the reason it may wait.').toEqual([]);
  });

  it('keeps the waiting list honest — every entry must still be called and still be missing', () => {
    // Once the endpoint lands, or the caller goes, the exemption must go too.
    for (const path of AWAITING_THEIR_ENDPOINT) {
      expect(calls.some((c) => c.path.startsWith(path)), `${path} is no longer called`).toBe(true);
      expect(resolves(toSegments(path)), `${path} now exists — remove the exemption`).toBe(false);
    }
  });
});

describe('the matcher', () => {
  it('matches a dynamic segment', () => {
    expect(resolves(toSegments('/api/concierge/profiles/${id}/pdf'))).toBe(true);
  });

  it('ignores the query string', () => {
    expect(resolves(toSegments('/api/reports?page=2&type=farming'))).toBe(true);
  });

  it('does not let an interpolation stand in for a literal segment', () => {
    // /api/sales/${x} must not be taken as proof that /api/sales/commission exists.
    expect(resolves(['sales', '*'])).toBe(routes.some((r) => r.length === 2 && r[0] === 'sales' && r[1]!.startsWith('[')));
  });

  it('fails the two endpoints that were never written', () => {
    expect(resolves(toSegments('/api/sales/commission'))).toBe(false);
    expect(resolves(toSegments('/api/sales/reports'))).toBe(false);
  });

  it('knows the route tree exists where it thinks it does', () => {
    expect(existsSync(API_DIR)).toBe(true);
    expect(routes.length).toBeGreaterThan(50);
  });
});
