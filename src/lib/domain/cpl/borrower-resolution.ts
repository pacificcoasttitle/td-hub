import { parseSiteXOwners } from '@/lib/domain/orders/names/sitex-owner-names';

// ─── Who the CPL names as the borrower ──────────────────────────────────────
//
// Legacy read ONE column and never touched a party table (`Fnf.php:331`, `510`
// — `$orderDetails['borrowers_vesting']`), captured from the form
// (`Common.php:1688`) with a fallback chain to the record owners
// (`Common.php:2167-2180`). It ran no validation at all: grepping `Fnf.php` for
// required/validate/throw returns nothing.
//
// We required an `order_parties` row with role 'buyer', which legacy never
// used, and blocked on its absence. That check passes on 51.8% of orders.
//
// This restores legacy's shape with one measured departure, below.
//
// ─── THE DEPARTURE: the record owner is NOT the borrower on a Purchase ──────
//
// Legacy's fallback used the record owner regardless of transaction type. On
// the current book that is right for a refinance and wrong for a purchase.
// Comparing `order_properties.primary_owner` against the order's parties by
// token set, on every order that has both:
//
//   Refinance   2,057 comparable   matches SELLER   0%   matches BUYER  74%
//   Purchase    2,298 comparable   matches SELLER  39%   matches BUYER  21%
//
// On a refinance the owner of record IS the borrower. On a purchase they are
// the seller — nearly two to one against being the buyer, which is what the
// legacy fallback would have printed on the letter.
//
// Order 8051, the first real CPL attempt, is the case in miniature: seller
// "Kevin Dell", `primary_owner` "DELL KEVIN", no buyer party. Legacy's chain
// would have named the seller as borrower on a lender's indemnity.
//
// So the owner fallback is applied on everything EXCEPT a purchase. On a
// purchase the operator's own entry is the only source, and its absence is
// reported rather than papered over.

export type BorrowerSource =
  | 'operator'      // the modal's borrower field
  | 'party'         // order_parties role='buyer'
  | 'record_owner'  // order_properties.primary_owner / secondary_owner
  | 'none';

export interface BorrowerResolution {
  names: string[];
  source: BorrowerSource;
  /** Shown to the operator. Null when the value came from their own typing. */
  note: string | null;
}

export interface BorrowerInputs {
  /** What the operator typed. Always wins. */
  override?: string | null;
  /** external_name of every order_parties row with role 'buyer'. */
  buyerParties: string[];
  primaryOwner?: string | null;
  secondaryOwner?: string | null;
  transactionType: string | null;
}

/**
 * Corporate markers. These may ONLY decide WHETHER to reformat a name — never
 * which token is a first or last name, and never which field a value lands in.
 * A match means "leave this string exactly as it is".
 *
 * That restriction is the whole point: a list that picks names gets a name
 * wrong the first time a person is called Marshall or Church. A list that only
 * abstains can, at worst, leave a person's name in record order — visibly odd,
 * never incorrect.
 */
const ENTITY_MARKERS = [
  'LLC', 'L L C', 'INC', 'CORP', 'CORPORATION', 'COMPANY', 'CO',
  'TRUST', 'LP', 'LLP', 'LTD', 'PARTNERSHIP', 'ASSOCIATION',
  'BANK', 'FOUNDATION', 'MINISTRIES', 'CHURCH', 'ESTATE',
  'INVESTMENT', 'INVESTMENTS', 'PROPERTIES', 'HOLDINGS', 'ENTERPRISES',
];

/** Word-boundary test. `includes()` matches CO inside CONNOR. */
export function hasEntityMarker(name: string): boolean {
  return hasMarker(name);
}

/** Word-boundary test. `includes()` matches CO inside CONNOR. */
function hasMarker(name: string): boolean {
  const tokens = name.toUpperCase().replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter(Boolean);
  return tokens.some((t) => ENTITY_MARKERS.includes(t));
}

/**
 * Record-order name to natural order, unless it is an entity.
 *
 * `parseSiteXOwners` is a PERSON parser — it turns "LUCHSHEYE CORP" into
 * "Corp Luchsheye". The entity check runs first so a company is never fed to
 * it. A trust or company that contains `&` is kept whole — that ampersand is
 * part of the name, not a second owner.
 */
export function renderBorrowerName(raw: string): string {
  const name = raw.trim();
  if (name === '') return '';
  if (classifyPartyName(name) !== 'person') return name;
  if (hasMarker(name)) return name;

  const parsed = parseSiteXOwners(name);
  const parts = [parsed.primary?.firstName, parsed.primary?.middleName, parsed.primary?.lastName];
  const rendered = parts.filter((p) => p && p.trim() !== '').join(' ').trim();

  // A parser that produced nothing usable must not erase the name.
  return rendered === '' ? name : rendered;
}

/** Split "A; B" / "A & B" the way the record owner columns store them. */
function splitOwners(raw: string): string[] {
  return raw.split(/;| & /).map((s) => s.trim()).filter((s) => s !== '');
}

function recordOwnerNames(primary?: string | null, secondary?: string | null): string[] {
  const out: string[] = [];
  for (const raw of [primary, secondary]) {
    const value = (raw ?? '').trim();
    if (!value) continue;
    // A trust or company is one name even when it contains `&`.
    if (classifyPartyName(value) !== 'person') {
      out.push(value);
      continue;
    }
    out.push(...splitOwners(value).map(renderBorrowerName).filter((n) => n !== ''));
  }
  return out;
}

export function resolveBorrowers(i: BorrowerInputs): BorrowerResolution {
  const override = i.override?.trim();
  if (override) {
    // The operator typed it. Take it verbatim — they can see the letter and we
    // must not second-guess a name a person entered on purpose.
    return { names: [override], source: 'operator', note: null };
  }

  const parties = i.buyerParties.map((n) => n.trim()).filter((n) => n !== '');
  if (parties.length > 0) {
    return {
      names: parties,
      source: 'party',
      note: null,
    };
  }

  // Purchase: the record owner is the seller far more often than the buyer.
  // Refuse rather than print the wrong party on a lender's indemnity.
  if ((i.transactionType ?? '').trim() === 'Purchase') {
    return {
      names: [],
      source: 'none',
      note: 'No borrower on this order. On a purchase the owner of record is the seller, '
        + 'so it has not been substituted — enter the buyer to name them on the letter.',
    };
  }

  const names = recordOwnerNames(i.primaryOwner, i.secondaryOwner);
  if (names.length > 0) {
    return {
      names,
      source: 'record_owner',
      note: `Borrower taken from the owner of record (${names.join(', ')}). `
        + 'Enter a borrower above to use a different name.',
    };
  }

  return {
    names: [],
    source: 'none',
    note: 'No borrower on this order and no owner of record to fall back to.',
  };
}

// ─── Which name field does this belong in? ──────────────────────────────────
//
// Westcor's name object is not a free-text box. The spec:
//
//   CompanyName  CONDITIONAL: Required if first name and last name are not
//                provided
//   Trust        If the name has been determined to be a trust, then it goes
//                into this field
//   First/Last   CONDITIONAL: Required if company name is not provided
//
// We put every name into `First` with `Last: '-'`, entities included. So a
// family trust goes onto a closing protection letter as a person whose surname
// is a hyphen — the same shape as the surname "6607" defect.
//
// THE MARKER LIST STILL ONLY ADDS A ROUTE. When it abstains, the name takes
// exactly the path it takes today, unchanged. It never reassigns a person's
// tokens between First and Last, and it never removes a route that currently
// works — persons render correctly on issued letters today and that behaviour
// is untouched.

export type NameKind = 'person' | 'trust' | 'company';

/**
 * WORD BOUNDARIES, and no TRUSTEE.
 *
 * The first version of this line was written through a shell heredoc and the
 * \b escapes became literal backspace bytes, producing a regex that matched
 * nothing. Third time that escaping trap has bitten in this session.
 *
 * Without real word boundaries it would match "TRUSTWORTHY REALTY", "TRUSTED
 * HOME LOANS" and a person named "TRUSTINGHAM" — the exact defect class it
 * exists to prevent.
 *
 * TRUSTEE is deliberately absent. Measured earlier: of 998 abstentions, 11
 * matched TRUSTEE and nothing else, and all 11 were people —
 * "DANNA MICHAEL A (TRUSTEE)". A trustee is a person acting for a trust.
 */
// TRUSTEE is still absent: "DANNA MICHAEL A (TRUSTEE)" is a person.
// Bare TR is not — SiteX writes "NGUYEN, GIAHUY H TR G H" / "NGUYEN LIVING TR",
// and the letter sweep printed those as "Giahuy H Tr G H Nguyen" and
// "Living Tr Nguyen". \bTR\b does not match TRUSTEE.
const TRUST_MARKER = /\bTRUST\b|\bLIVING TR\b|\bFAMILY TR\b|\bREV(?:OCABLE)? TR\b|\bREV T\b|\bTR\b/i;

/**
 * Vesting prose that is not a name. Westcor's person path takes the last
 * token as Last, so "husband and wife as joint tenants" printed Tenants as
 * the borrower, and a trust "dated September 01, 2016" printed 2016.
 *
 * These only REMOVE a clause. They never invent a person or pick a surname.
 */
const VESTING_CLAUSE = [
  /,?\s*(all\s+)?as\s+joint\s+tenants\b.*$/i,
  /,?\s*(as\s+)?tenants\s+in\s+common\b.*$/i,
  /,?\s*husband\s+and\s+wife\b.*$/i,
  /,?\s*as\s+(his|her)\s+sole\s+and\s+separate\s+property\b.*$/i,
  /,?\s*as\s+to\s+an\s+undivided\b[^,]*/gi,
  /,?\s*a(n)?\s+(single|unmarried|married)\s+(man|woman)\b[^,]*/gi,
  /,?\s*a\s+widow(ed)?\b[^,]*/gi,
];

const JUNK_FRAGMENT = /^(?:\d{4}|tenants|common|trustee|trustees|dated|and)$/i;

export function looksLikeVesting(raw: string): boolean {
  const name = (raw ?? '').trim();
  if (!name) return false;
  if (classifyPartyName(name) === 'trust') return true;
  return /joint\s+tenants|tenants\s+in\s+common|trustee\s+of\b|dated\s+\w+|husband\s+and\s+wife|undivided/i.test(name);
}

export function stripVestingClauses(raw: string): string {
  let name = (raw ?? '').trim().replace(/[.,;]+$/g, '');
  let prev = '';
  while (name !== prev) {
    prev = name;
    for (const clause of VESTING_CLAUSE) {
      name = name.replace(clause, '').trim().replace(/[.,;]+$/g, '');
    }
  }
  return name.replace(/\s+/g, ' ').trim();
}

export function isJunkNameFragment(raw: string): boolean {
  const name = stripVestingClauses(raw);
  if (!name) return true;
  return JUNK_FRAGMENT.test(name);
}

/**
 * The modal's seller box uses "; " / ", " as a people separator. A pasted
 * vesting is one name that happens to contain commas — "Trust dated
 * September 01, 2016" is not three people, the last of whom is called 2016.
 */
export function splitTypedNames(raw?: string | null): string[] {
  const value = (raw ?? '').trim();
  if (!value) return [];
  if (looksLikeVesting(value)) return [value];
  return value.split(/;|,/).map((n) => n.trim()).filter((n) => n !== '');
}

/**
 * `trust` is tested before `company` because a trust name almost always also
 * carries a generic entity marker, and the spec gives trusts their own field.
 */
export function classifyPartyName(raw: string): NameKind {
  const name = (raw ?? '').trim();
  if (!name) return 'person';
  if (TRUST_MARKER.test(name)) return 'trust';
  if (hasMarker(name)) return 'company';
  return 'person';
}
