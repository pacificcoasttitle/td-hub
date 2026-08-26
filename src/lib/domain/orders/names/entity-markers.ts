// ─── Entity markers — a list that may only ABSTAIN ──────────────────────────
//
// This list decides WHETHER to transform an owner string. It never decides HOW.
// It cannot pick a first name, a last name, a field or a party role. Its only
// possible effect is to make the parser keep its hands off a string and warn.
//
// That asymmetry is the whole design, and it is what makes a guess acceptable
// here when it was not acceptable anywhere else in this work:
//
//   wrong positive (a person flagged)  -> their name passes through unsplit
//                                          with a warning on screen. Visible,
//                                          and the operator fixes it in place.
//   wrong negative (an entity missed)  -> exactly today's behaviour, no worse.
//   if it could transform              -> "5558 RIVERTON LLC" becomes a human
//                                          being named 5558 and nobody sees it.
//
// So the list is allowed to be imperfect in one direction only. Every entry is
// a token that does not appear in a personal name as a standalone word.
//
// USED ONLY when SiteX gave us no current-owner deed. When the deed is present
// the discriminator is structural — FirstAndMiddleName absent — and this list
// is not consulted at all.

/**
 * Standalone tokens that mark an organization.
 *
 * Deliberately NOT here:
 *   CO      — collides with nothing useful; "CO" alone is rare and ambiguous
 *   TR      — a common abbreviation for TRUSTEE but also initials
 *   ET AL   — appears on personal vestings ("SMITH JOHN ET AL")
 *   THE     — leads plenty of entity names but far too broad
 *   ESTATE  — "ESTATE OF JOHN SMITH" is a person's estate, not a company
 *   TRUSTEE — a PERSON acting as trustee is a person. Measured: of 998
 *             abstentions, 11 matched TRUSTEE and nothing else, and all 11
 *             were people ("DANNA MICHAEL A (TRUSTEE)"). No entity in 5,418
 *             stored owner strings relies on it, so it only ever cost real
 *             people a parse.
 */
const ENTITY_TOKENS = new Set([
  'LLC', 'L.L.C', 'LLP', 'PLLC', 'INC', 'INCORPORATED', 'CORP', 'CORPORATION',
  'COMPANY', 'CO.', 'LTD', 'LIMITED', 'PARTNERSHIP', 'PARTNERS',
  'TRUST',
  'FOUNDATION', 'ASSOCIATION', 'ASSOCIATES', 'ORGANIZATION',
  'HOLDINGS', 'INVESTMENTS', 'INVESTMENT', 'VENTURES', 'CAPITAL', 'GROUP',
  'PROPERTIES', 'REALTY', 'ENTERPRISES', 'DEVELOPMENT', 'MANAGEMENT',
  'CHURCH', 'MINISTRIES', 'BANK', 'CREDIT UNION',
  'CITY OF', 'COUNTY OF', 'STATE OF',
]);

/**
 * Tokens short enough to be someone's initials. They match ONLY as the final
 * token, where an entity suffix lives.
 *
 * "SMITH FAMILY LP" is a partnership. "COOPER, LP JAMES" is a person whose
 * initials are L.P., and a positional-blind match on LP suppresses them — which
 * a test in entity-owners.test.ts caught before this shipped. Two-letter tokens
 * get the stricter rule; three or more do not need it.
 */
const FINAL_POSITION_ONLY = new Set(['LP']);

/** Multi-word markers, matched as a phrase. */
const ENTITY_PHRASES = [
  'CREDIT UNION', 'CITY OF', 'COUNTY OF', 'STATE OF', 'LIVING TRUST',
  'FAMILY TRUST', 'REVOCABLE TRUST', 'IRREVOCABLE TRUST', 'DBA',
];

export type EntityMarker = { matched: true; token: string } | { matched: false };

/**
 * A phrase must sit on word boundaries. Plain `includes()` reads "STATE OF"
 * inside "ESTATE OF" and flags "HARRIS JOSEPH JR ESTATE OF HARRIS EULA MAE" —
 * a person's estate — as a government entity.
 *
 * Measuring the list against all 5,418 stored owner strings is what surfaced
 * it; two real people were being suppressed. Phrases here are plain words and
 * spaces, so the boundaries are checked directly rather than by building a
 * regex out of user-adjacent text.
 */
function phraseBoundaryTest(haystack: string, phrase: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(phrase, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : haystack[at - 1]!;
    const afterIdx = at + phrase.length;
    const after = afterIdx >= haystack.length ? '' : haystack[afterIdx]!;
    const isWordChar = (c: string) => c !== '' && /[A-Z0-9]/.test(c);
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

/**
 * Does this owner string carry a marker that says "organization"?
 *
 * Tokens are compared whole, after stripping surrounding punctuation, so
 * "INCLINE" does not match "INC" and "CORPUS" does not match "CORP" — the
 * substring version of this check is how a person named Vincent becomes a
 * company.
 */
export function entityMarker(raw: string | null | undefined): EntityMarker {
  const s = (raw ?? '').trim();
  if (!s) return { matched: false };

  const upper = s.toUpperCase();
  for (const phrase of ENTITY_PHRASES) {
    // WORD BOUNDARIES, not includes(). A bare substring match reads "STATE OF"
    // inside "ESTATE OF" and flags "HARRIS JOSEPH JR ESTATE OF HARRIS" — a
    // person's estate — as a government entity. Measuring the list against all
    // 5,418 stored owner strings is what surfaced that; two real people were
    // being suppressed by it.
    if (phraseBoundaryTest(upper, phrase)) return { matched: true, token: phrase };
  }

  const tokens = upper.split(/[\s,;]+/);
  for (const [i, token] of tokens.entries()) {
    const bare = token.replace(/^[^A-Z0-9.]+|[^A-Z0-9.]+$/g, '');
    if (!bare) continue;
    const undotted = bare.replace(/\./g, '');
    if (FINAL_POSITION_ONLY.has(bare) || FINAL_POSITION_ONLY.has(undotted)) {
      // Only when nothing but punctuation follows.
      const rest = tokens.slice(i + 1).join('').replace(/[^A-Z0-9]/g, '');
      if (rest === '') return { matched: true, token: undotted };
      continue;
    }
    if (ENTITY_TOKENS.has(bare)) return { matched: true, token: bare };
    // "L.L.C." and "INC." keep their dots in the set where it matters; otherwise
    // compare with dots removed so "L.L.C" and "LLC" agree.
    if (undotted !== bare && ENTITY_TOKENS.has(undotted)) return { matched: true, token: undotted };
  }

  return { matched: false };
}

export function looksLikeEntity(raw: string | null | undefined): boolean {
  return entityMarker(raw).matched;
}
