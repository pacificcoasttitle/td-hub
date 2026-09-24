import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// ─── readSource is the only way in ──────────────────────────────────────────
//
// A guard that reads source text has one failure that costs: MATCHING NOTHING
// AND PASSING. A pattern that cannot match finds no violation, so the guard
// reports green while checking nothing. Twice in one day — a backslash eaten
// by a heredoc, and a slice against a file git checked out as CRLF.
//
// `test-support/read-source.ts` makes that impossible: it cannot read a file
// without being told something that must be in it, and throws when the anchor
// is gone. But a helper nobody is required to use is a convention, and a
// convention is a thing people have to remember.
//
// So this is the ratchet. The list below is every test that reads a `.ts` or
// `.tsx` source file with bare `readFileSync`, as it stood on 2026-09-23.
//
//   - A file NOT on the list doing it fails. New guards must use readSource.
//   - A file ON the list that has stopped doing it also fails, so the list
//     shrinks as they migrate and cannot quietly become a lie.
//
// This is the same move as there being no second comp mapping to grep for: the
// property is enforced by there being no other way, rather than by a rule
// somebody has to recall. It also retires "no new source-reading guard without
// a conversation" — the repo now declines it on its own.
//
// MIGRATING ONE IS TWO LINES: swap `readFileSync(p, 'utf8')` for
// `readSource(p, { mustContain: '<the declaration it is about>' })` and delete
// its entry here. Worth doing whenever one of these is opened for any reason.

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** `readFileSync(...)` whose argument names a .ts or .tsx file. */
const READS_SOURCE = /readFileSync\(([^)]*\.tsx?['"][^)]*)\)/g;

function testsReadingSource(): string[] {
  const out: string[] = [];
  for (const file of walk(SRC).filter((f) => /\.test\.tsx?$/.test(f))) {
    const src = readFileSync(file, 'utf8');
    if ([...src.matchAll(READS_SOURCE)].length > 0) {
      out.push(relative(SRC, file).split('\\').join('/'));
    }
  }
  return out.sort();
}

/**
 * The population on the day the helper landed. THIS LIST ONLY SHRINKS.
 *
 * None of these are known to be broken. They are known not to have been
 * checked — a distinction worth keeping, because collapsing it is how a number
 * that describes what somebody looked at gets reported as a total.
 */
const BEFORE_READSOURCE = [
  'app/api/orders/[id]/route.test.ts',
  'components/admin/contacts/manager-assign-modal.test.ts',
  'components/hub/hub-search-stays-in-hub.test.ts',
  'components/sales/closed-files-drilldown-modal.test.ts',
  'components/shared/action-modals/admin-detail-parity.test.ts',
  'components/shared/action-modals/detail-modal-ux.test.ts',
  'components/shared/action-modals/modal-parent-refresh.test.ts',
  'components/shared/action-modals/modal-polish-b.test.ts',
  'components/shared/property-confirm-modal.test.ts',
  'lib/domain/notifications/confirmation-attachment-record.test.ts',
  'lib/domain/notifications/confirmation-documents.test.ts',
  'lib/domain/notifications/deliverable-emails.test.ts',
  'lib/domain/notifications/outstanding-documents-alert.test.ts',
  'lib/domain/notifications/pre-send-refresh.test.ts',
  'lib/domain/orders/names/classify-owners.test.ts',
  'lib/domain/orders/names/names.test.ts',
  'lib/domain/orders/names/owner-routing.test.ts',
  'lib/domain/orders/names/production-regressions.test.ts',
  'lib/domain/orders/subresource-loaders.test.ts',
  'lib/integrations/softpro/create-timeout.test.ts',
  'lib/jobs/handlers/backfill-te-prelims.test.ts',
  'lib/jobs/handlers/fetch-prelims-endpoint.test.ts',
  'lib/jobs/handlers/retry-held-prelim-no-recipient.test.ts',
  'lib/jobs/handlers/retry-held-prelim-watched-ten.test.ts',
  'lib/orders/claim-create-in-flight.test.ts',
] as const;

describe('new guards cannot read source without an anchor', () => {
  const current = testsReadingSource();

  it('finds the tests at all', () => {
    // A detector that silently matched nothing would let everything through
    // while reporting green — the exact failure this file exists to stop,
    // reproduced inside it.
    expect(walk(SRC).filter((f) => /\.test\.tsx?$/.test(f)).length).toBeGreaterThan(200);
    expect(current.length).toBeGreaterThan(0);
  });

  it('has no test reading source with bare readFileSync outside the baseline', () => {
    const added = current.filter((f) => !BEFORE_READSOURCE.includes(f as never));
    expect(added, 'this test reads a source file with bare readFileSync. Use '
      + 'readSource(path, { mustContain: … }) from @/test-support/read-source — a guard '
      + 'that cannot find what it is looking for must fail, not pass.')
      .toEqual([]);
  });

  it('keeps the baseline honest — an entry that has migrated must be removed', () => {
    // An allowlist that never shrinks stops describing anything.
    const stale = BEFORE_READSOURCE.filter((f) => !current.includes(f));
    expect(stale, 'these no longer read source with bare readFileSync. Delete them '
      + 'from BEFORE_READSOURCE — the list only shrinks.')
      .toEqual([]);
  });

  it('is a ratchet: the baseline is the high-water mark', () => {
    expect(current.length).toBeLessThanOrEqual(BEFORE_READSOURCE.length);
  });
});
