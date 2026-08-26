import { nameTitleCase } from './title-case';
import { splitFullName, type PersonName } from './split-full-name';
import { entityMarker } from './entity-markers';

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
//
// THE FLIP IS NOT UNCONDITIONAL. It is what you do when the name is positional,
// and a name is positional only when SiteX did not delimit it with a comma. See
// OwnerSegment below: legacy flipped every segment, which is why
// "TIEU, DANIEL QUI & KHANH TRINH" — one surname, stated once — came out with a
// second owner called "Trinh Khanh".

/**
 * What SiteX's own records say the owner IS, when we can tell.
 *
 * 'entity'  the current-owner deed party has no FirstAndMiddleName key.
 *           Structural, from the vendor, not a guess.
 * 'person'  the same party HAS one.
 * 'unknown' no current-owner deed came back, so the question is unanswered.
 */
export type OwnerKind = 'entity' | 'person' | 'unknown';

/** Which branch a parse actually took. Recorded so coverage is a query. */
export type ParseBranch =
  | 'entity-deed'      // deed said entity — passed through whole
  | 'entity-marker'    // no deed, but the string carries an entity marker — abstained
  | 'person-deed'      // deed said person — parsed
  | 'person-parsed'    // no deed, no marker — parsed, exactly as before
  | 'empty';

export interface SiteXOwners {
  primary: PersonName | null;
  secondary: PersonName | null;
  /** Things a human should see rather than have silently decided for them. */
  warnings: string[];
  /**
   * True when the owner is an organization and the string was left intact.
   * lastName holds the whole legal name; firstName and middleName are empty.
   */
  isEntity: boolean;
  /** For instrumentation. See ParseBranch. */
  branch: ParseBranch;
}

/**
 * An organization is not a name to be split, flipped or cased. "5558 RIVERTON
 * LLC" is the party's name exactly as recorded, and SoftPro stores it in the
 * same field a person's name goes in — verified against 12 synced orders, where
 * buyer.Company.PrimaryBorrower was null in every LLC/CORP/trust case.
 *
 * So: whole string into lastName, nothing invented, no title-casing. Casing a
 * legal entity turns "1501 Reeves Holdings, LLC" into "... Llc".
 */
function entityOwner(raw: string, branch: ParseBranch, warnings: string[], marker?: string): SiteXOwners {
  warnings.push(
    marker
      ? `"${raw}" looks like an organization (matched "${marker}") and SiteX returned no current-owner deed to confirm it. Left exactly as received rather than split into a person — check it before sending.`
      : `"${raw}" is an organization per SiteX's current-owner deed. Left exactly as received.`,
  );
  return {
    primary: { firstName: '', middleName: '', lastName: raw },
    secondary: null,
    warnings,
    isEntity: true,
    branch,
  };
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
 * What one owner segment says about its own surname.
 *
 * SiteX writes owner names in one of two grammars, and the COMMA is what tells
 * them apart:
 *
 *   no comma -> positional. "SANCHEZ SERGIO T" means LAST FIRST MIDDLE, so the
 *               surname is the first token and the flip applies.
 *   comma    -> explicit.   "DE VEYRA, TED T" states the surname before the
 *               comma, and it may be more than one token.
 *
 * The comma is a delimiter the vendor put there, so reading it is not a guess
 * about which token happens to look like a surname. That distinction is the
 * only reason the shared-surname shape below can be handled at all.
 */
interface OwnerSegment {
  /** The surname this segment states for itself. Null when it states none. */
  statedSurname: string | null;
  /** Given names when a surname was stated; otherwise the whole segment. */
  rest: string;
}

function readSegment(segment: string): OwnerSegment {
  const titled = nameTitleCase(segment.trim());
  const comma = titled.indexOf(',');
  if (comma === -1) return { statedSurname: null, rest: titled };

  const before = titled.slice(0, comma).trim();
  const after = titled.slice(comma + 1).trim();

  // A comma with nothing on one side of it is not a surname delimiter. It is
  // the trailing comma left by SiteX truncating an entity name to 40 characters
  // ("B & A GROUP INC,"). Those are a separate problem with their own ticket;
  // until it is taken, they behave exactly as they did before.
  if (!before || !after) return { statedSurname: null, rest: stripFirstComma(titled).trim() };

  return { statedSurname: before, rest: after };
}

/** Split the given names off a segment whose surname is already known. */
function givenNames(rest: string): { firstName: string; middleName: string } {
  const parts = rest.split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', middleName: parts.slice(1).join(' ') };
}

interface ResolvedOwner {
  name: PersonName;
  singleToken: boolean;
  /** Surname taken from the first owner because this one stated none. */
  inheritedSurname: string | null;
}

/**
 * One rule, three branches, decided per segment by the comma and nothing else.
 */
function resolveOwner(seg: OwnerSegment, inheritable: string | null): ResolvedOwner {
  // 1. The segment states its own surname. Nothing to reorder — the comma
  //    already said which part is which, including multi-word surnames like
  //    "De Veyra" that the positional flip used to cut in half.
  if (seg.statedSurname) {
    return {
      name: { ...givenNames(seg.rest), lastName: seg.statedSurname },
      singleToken: false,
      inheritedSurname: null,
    };
  }

  // 2. The segment states no surname, and the first owner did. This is
  //    "TIEU, DANIEL QUI & KHANH TRINH" — the surname is stated once and both
  //    owners carry it. The segment is given names only, so there is no
  //    surname inside it to flip, and flipping is what used to turn
  //    "Khanh Trinh" into "Trinh Khanh".
  if (inheritable) {
    return {
      name: { ...givenNames(seg.rest), lastName: inheritable },
      singleToken: false,
      inheritedSurname: inheritable,
    };
  }

  // 3. No comma anywhere. Positional, exactly as legacy.
  const flipped = splitFullName(flipLastFirstToNatural(seg.rest));
  return {
    name: { firstName: flipped.firstName, middleName: flipped.middleName, lastName: flipped.lastName },
    singleToken: flipped.singleToken,
    inheritedSurname: null,
  };
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
  ownerKind: OwnerKind = 'unknown',
): SiteXOwners {
  const warnings: string[] = [];
  const rawPrimary = (primaryOwnerName ?? '').trim();
  if (!rawPrimary) {
    return { primary: null, secondary: null, warnings, isEntity: false, branch: 'empty' };
  }

  // ── The three-way rule ───────────────────────────────────────────────────
  //
  // 1. The deed said entity. Definitive; nothing else is consulted.
  if (ownerKind === 'entity') return entityOwner(rawPrimary, 'entity-deed', warnings);

  // 2. No deed, and the string carries an entity marker. ABSTAIN. The marker
  //    list may only ever reach this branch — it can suppress a transformation
  //    and can never choose one, so a wrong match costs a warning rather than a
  //    fabricated person.
  if (ownerKind === 'unknown') {
    const marker = entityMarker(rawPrimary);
    if (marker.matched) return entityOwner(rawPrimary, 'entity-marker', warnings, marker.token);
  }

  // 3. Everything else parses exactly as it did before. "SANCHEZ SERGIO T"
  //    must keep working; that case is not being traded for safety on another.

  // 1. Multi-owner split comes FIRST, before any other transformation, so the
  //    delimiter is still where SiteX put it.
  const [p0, s0] = splitOwners(rawPrimary, (secondaryOwnerName ?? '').trim());

  // 2. Read what each segment says about its own surname BEFORE anything
  //    strips the comma that carries it. The old order title-cased and stripped
  //    the comma per owner, which destroyed the evidence before it was read.
  const primarySeg = readSegment(p0);
  const secondarySeg = s0.trim() ? readSegment(s0) : null;

  if (secondarySeg && (secondarySeg.rest.includes('&') || secondarySeg.rest.includes(';'))) {
    warnings.push(
      `Three or more owners in one string — only the first two were separated. Secondary reads "${secondarySeg.rest}".`,
    );
  }

  // 3. The primary has no earlier owner to inherit from, so it is either
  //    explicit (comma) or positional. Only the secondary can inherit.
  const primary = resolveOwner(primarySeg, null);
  const secondary = secondarySeg ? resolveOwner(secondarySeg, primarySeg.statedSurname) : null;

  if (primary.singleToken) {
    warnings.push(
      `Owner "${primarySeg.rest}" is a single word — recorded as a last name with no first name. Check it before sending.`,
    );
  }
  if (secondary?.singleToken) {
    warnings.push(
      `Second owner "${secondarySeg!.rest}" is a single word — recorded as a last name with no first name. Check it before sending.`,
    );
  }
  if (secondary?.inheritedSurname) {
    warnings.push(
      `Second owner "${secondarySeg!.rest}" states no surname of its own — "${secondary.inheritedSurname}" was carried over from the first owner, as the comma indicates.`,
    );
  }

  return {
    primary: primary.name,
    secondary: secondary?.name ?? null,
    warnings,
    isEntity: false,
    branch: ownerKind === 'person' ? 'person-deed' : 'person-parsed',
  };
}
