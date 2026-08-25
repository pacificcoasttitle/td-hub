import { nameTitleCase } from './title-case';
import { splitFullName, type PersonName } from './split-full-name';

// ─── SiteX owner names — custom.js:920-941 ──────────────────────────────────
//
// THE FLIP LIVES HERE AND ONLY HERE.
//
// SiteX returns owner names as "LAST FIRST MIDDLE". Legacy reorders them in the
// browser at the moment SiteX fills the form, then marks the field readonly
// (custom.js:993-994) so nothing else can reach it. splitFullName then runs on
// submit for both paths and sees an already-natural name either way.
//
// If the flip were ever applied to a hand-typed name, "John Smith" would become
// "Smith John" and every manually keyed order would carry a reversed name. So
// the flip is not exported, this module has no general-purpose entry point, and
// the only thing callable from here takes a RAW SiteX payload field.
//
// There is a test that reads the submit-path source and asserts it does not
// import this module.

export interface SiteXOwners {
  primary: PersonName | null;
  secondary: PersonName | null;
  /** Things a human should see rather than have silently decided for them. */
  warnings: string[];
}

/**
 * Legacy splits on the FIRST ';' or, failing that, the FIRST '&'.
 *
 * "A & B & C" therefore yields primary "A" and secondary "B & C" — the third
 * owner stays glued to the second. Matched deliberately, and reported through
 * `warnings` so we can find out how often three-owner strings actually occur
 * before deciding whether to handle them.
 */
function splitOwners(primaryRaw: string, secondaryRaw: string): [string, string] {
  const semi = primaryRaw.indexOf(';');
  if (semi !== -1) {
    return [primaryRaw.slice(0, semi), primaryRaw.substring(semi + 1)];
  }
  const amp = primaryRaw.indexOf('&');
  if (amp !== -1) {
    return [primaryRaw.slice(0, amp), primaryRaw.substring(amp + 1)];
  }
  return [primaryRaw, secondaryRaw];
}

/**
 * "SANCHEZ SERGIO T" -> "Sergio T Sanchez".
 *
 * Legacy: take everything after the first space, append the first token.
 *
 *   last = name.split(' ')[0]
 *   name = name.substr(name.indexOf(' ') + 1) + ' ' + last
 *
 * NOT copied: when there is no space, indexOf returns -1, substr(0) returns the
 * whole string, and legacy emits "SMITH SMITH". A single token is left exactly
 * as it is.
 */
function flipLastFirstToNatural(name: string): string {
  const firstSpace = name.indexOf(' ');
  if (firstSpace === -1) return name;
  const last = name.slice(0, firstSpace);
  const rest = name.substring(firstSpace + 1);
  return `${rest} ${last}`;
}

/** Legacy uses `.replace(',', '')` — a string argument, so only the FIRST comma goes. */
function stripFirstComma(s: string): string {
  return s.replace(',', '');
}

/**
 * Parse SiteX owner names into natural-order person names.
 *
 * CALL THIS ONLY WITH RAW SiteX FIELDS (PrimaryOwnerName / SecondaryOwnerName).
 * Never with anything a person typed.
 */
export function parseSiteXOwners(
  primaryOwnerName: string | null | undefined,
  secondaryOwnerName?: string | null,
): SiteXOwners {
  const warnings: string[] = [];
  const rawPrimary = (primaryOwnerName ?? '').trim();
  if (!rawPrimary) return { primary: null, secondary: null, warnings };

  // 1. Multi-owner split comes FIRST, before any other transformation, so the
  //    delimiter is still where SiteX put it.
  const [p0, s0] = splitOwners(rawPrimary, (secondaryOwnerName ?? '').trim());

  // 2..4. Legacy's order: trim, title-case, strip the first comma. Per owner.
  const prep = (s: string) => stripFirstComma(nameTitleCase(s.trim()));
  const primaryPrepped = prep(p0);
  const secondaryPrepped = s0 ? prep(s0) : '';

  if (secondaryPrepped.includes('&') || secondaryPrepped.includes(';')) {
    warnings.push(
      `Three or more owners in one string — only the first two were separated. Secondary reads "${secondaryPrepped}".`,
    );
  }

  // 5. Flip each owner independently.
  const primary = splitFullName(flipLastFirstToNatural(primaryPrepped));
  const secondary = secondaryPrepped
    ? splitFullName(flipLastFirstToNatural(secondaryPrepped))
    : null;

  if (primary.singleToken) {
    warnings.push(
      `Owner "${primaryPrepped}" is a single word — recorded as a last name with no first name. Check it before sending.`,
    );
  }
  if (secondary?.singleToken) {
    warnings.push(
      `Second owner "${secondaryPrepped}" is a single word — recorded as a last name with no first name. Check it before sending.`,
    );
  }

  const strip = (n: typeof primary): PersonName => ({
    firstName: n.firstName, middleName: n.middleName, lastName: n.lastName,
  });

  return { primary: strip(primary), secondary: secondary ? strip(secondary) : null, warnings };
}
