import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource } from '@/test-support/read-source';

const SRC = join(__dirname, '../../../');

// ─── The two routes must agree on who the operator is ───────────────────────
//
// They did not. The generate route writes `createdBy: session.email`; the
// suggestions route asked for `session.id`, a Supabase UUID. Measured on the
// real table: 0 rows matched the UUID, 9 matched the email. The endpoint
// returned an empty list for every user on every keystroke from the day it
// shipped, and it looked like a scoping question.
//
// NOTHING COULD HAVE CAUGHT THIS FROM ONE SIDE. Each route was internally
// correct; the defect lived in the gap between them, and the symptom — an empty
// list — is indistinguishable from "you have no history yet", which is the
// honest state of a new operator. So the guard has to read BOTH and compare.

describe('the identity written and the identity queried are the same', () => {
  const generate = readSource(join(SRC, 'app/api/concierge/profiles/route.ts'), {
    mustContain: 'createdBy:',
  });
  const suggest = readSource(join(SRC, 'app/api/concierge/prepared-for/route.ts'), {
    mustContain: 'preparedForSuggestions(',
  });

  it('the generate route stamps created_by with the email', () => {
    expect(generate).toContain('createdBy: session.email');
  });

  it('the suggestions route looks up by the same field', () => {
    expect(suggest).toContain('preparedForSuggestions(session.email');
    // The specific wrong one, named, because it is the mistake that was made
    // and it reads perfectly plausibly.
    expect(suggest).not.toContain('preparedForSuggestions(session.id');
  });

  it('they agree, compared rather than asserted twice', () => {
    // Anchored on the comparison itself: if either route changes which field it
    // uses, this fails even if somebody updates only one of the tests above.
    const written = /createdBy:\s*session\.(\w+)/.exec(generate)?.[1];
    const queried = /preparedForSuggestions\(session\.(\w+)/.exec(suggest)?.[1];
    expect(written, 'generate route: could not find what created_by is set from').toBeTruthy();
    expect(queried, 'suggestions route: could not find what it queries by').toBeTruthy();
    expect(queried).toBe(written);
  });
});

describe('the query cannot be defeated by letter case', () => {
  it('matches created_by case-insensitively', () => {
    // An exact match fails silently — an empty list is a legitimate answer for
    // a new operator, so nobody can tell it apart from a broken one.
    const src = readSource(join(SRC, 'lib/domain/concierge/prepared-for.ts'), {
      mustContain: 'export async function preparedForSuggestions',
    });
    expect(src).toMatch(/lower\([^)]*createdBy[^)]*\)\s*=\s*lower\(/);
  });

  it('still refuses to run with no operator at all', () => {
    // Scoping is the point of the function: an empty createdBy must return
    // nothing rather than everyone's list.
    const src = readSource(join(SRC, 'lib/domain/concierge/prepared-for.ts'), {
      mustContain: 'export async function preparedForSuggestions',
    });
    expect(src).toContain('if (!createdBy) return [];');
  });
});
