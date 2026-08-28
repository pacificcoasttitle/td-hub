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
function hasMarker(name: string): boolean {
  const tokens = name.toUpperCase().replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter(Boolean);
  return tokens.some((t) => ENTITY_MARKERS.includes(t));
}

/**
 * Record-order name to natural order, unless it is an entity.
 *
 * `parseSiteXOwners` is a PERSON parser — it turns "LUCHSHEYE CORP" into
 * "Corp Luchsheye". The entity check runs first so a company is never fed to
 * it.
 */
export function renderBorrowerName(raw: string): string {
  const name = raw.trim();
  if (name === '') return '';
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

  const owners = [
    ...splitOwners(i.primaryOwner ?? ''),
    ...splitOwners(i.secondaryOwner ?? ''),
  ];
  if (owners.length > 0) {
    const names = owners.map(renderBorrowerName).filter((n) => n !== '');
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
