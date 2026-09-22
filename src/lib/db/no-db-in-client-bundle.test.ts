import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ─── No database in the browser bundle ──────────────────────────────────────
//
// On 2026-09-17 the Reports list page imported REPORTS_PAGE_SIZE — one number —
// from a module that also imports the postgres client. One value import is
// enough: Turbopack followed it into the client bundle, failed on
// `Can't resolve 'fs'`, and production did not deploy for fifteen hours
// (commit 251432b).
//
// `tsc --noEmit` passed. The whole test suite passed. Neither of them bundles,
// and the required checks do not run a build, so the only thing that noticed was
// the Vercel deployment nobody was watching.
//
// This walks the real import graph from every `'use client'` file and fails if
// it reaches the driver. TYPE-ONLY IMPORTS ARE ERASED and therefore allowed —
// that is exactly the distinction the failure turned on.

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../..');
const DB_CLIENT = resolve(SRC, 'lib/db/client.ts');

function walkDir(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkDir(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function isClientFile(file: string): boolean {
  const head = readFileSync(file, 'utf8').slice(0, 200);
  return /^\s*(['"])use client\1/.test(head);
}

/** Import specifiers that survive compilation. Type-only ones do not. */
const importsMemo = new Map<string, string[]>();

function valueImports(file: string): string[] {
  const cached = importsMemo.get(file);
  if (cached) return cached;
  const found = readValueImports(file);
  importsMemo.set(file, found);
  return found;
}

function readValueImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const clause = m[1]!.trim();
    const spec = m[2]!;
    if (/^type\b/.test(clause)) continue;
    const braced = clause.match(/^\{([\s\S]*)\}$/);
    if (braced) {
      const members = braced[1]!.split(',').map((s) => s.trim()).filter(Boolean);
      if (members.length > 0 && members.every((s) => /^type\b/.test(s))) continue;
    }
    out.push(spec);
  }
  return out;
}

function resolveSpec(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2))
    : spec.startsWith('.') ? resolve(dirname(from), spec)
      : null;
  if (base === null) return null; // a package, not ours
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The chain from a client file to the driver, or null if it never gets there. */
/**
 * Every file's answer is worked out ONCE and shared across entry points.
 *
 * The first version re-walked the whole graph from scratch for every client
 * component — cost growing with the square of the codebase — and on
 * 2026-09-21 it passed the 5-second timeout without having found anything. A
 * guard that times out is a guard that gets its timeout raised until it
 * means nothing, so the walk is memoised instead.
 *
 * CYCLES. A file already on the current path is not re-entered; that branch is
 * cut. A "does not reach the driver" answer computed with a branch cut is
 * INCOMPLETE — the cut branch might have reached it — so only complete answers
 * are cached. A chain that does reach the driver is true however it was found.
 */
const reachMemo = new Map<string, string[] | null>();

function reach(file: string, onPath: Set<string>): { chain: string[] | null; complete: boolean } {
  if (reachMemo.has(file)) return { chain: reachMemo.get(file)!, complete: true };
  if (onPath.has(file)) return { chain: null, complete: false };
  onPath.add(file);
  let complete = true;
  let chain: string[] | null = null;
  for (const spec of valueImports(file)) {
    const next = resolveSpec(spec, file);
    if (next === null) continue;
    if (next === DB_CLIENT) { chain = [file, next]; break; }
    const sub = reach(next, onPath);
    if (sub.chain) { chain = [file, ...sub.chain]; break; }
    if (!sub.complete) complete = false;
  }
  onPath.delete(file);
  if (chain || complete) reachMemo.set(file, chain);
  return { chain, complete: complete || chain !== null };
}

/** The chain from a client file to the driver, or null if it never gets there. */
function pathToDriver(entry: string): string[] | null {
  return reach(entry, new Set()).chain;
}

describe('the client bundle', () => {
  const clientFiles = walkDir(join(SRC, 'components')).filter(isClientFile);

  it('has client components to check at all', () => {
    // A resolver bug that found nothing would otherwise pass silently.
    expect(clientFiles.length).toBeGreaterThan(20);
  });

  it('never reaches the postgres client from a component the browser loads', () => {
    const offenders = clientFiles
      .map((f) => ({ file: f, chain: pathToDriver(f) }))
      .filter((r) => r.chain !== null)
      .map((r) => r.chain!.map((c) => relative(SRC, c)).join('\n    → '));

    expect(offenders).toEqual([]);
  });

  it('follows a value import and ignores a type-only one, which is the distinction that broke the build', () => {
    // Guards the walker itself: the Reports page imports the row TYPE from the
    // module with the query in it, and that is fine. REPORTS_PAGE_SIZE is not.
    const page = join(SRC, 'components/admin/reports/reports-list-page.tsx');
    expect(valueImports(page)).not.toContain('@/lib/domain/reports/list');
    expect(resolveSpec('@/lib/db/client', page)).toBe(DB_CLIENT);
  });
});
