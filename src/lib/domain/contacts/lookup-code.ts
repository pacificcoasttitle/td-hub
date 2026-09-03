/**
 * Legacy-deterministic SoftPro lookup codes.
 *
 * Company: strip spaces from name, first 4, ucfirst + same for address → concat.
 * Person: first 3 of first + first 3 of last + first 4 of company, ucfirst each.
 * No minimum length. Collisions append 1, 2, 3.
 */

function stripSpaces(value: string): string {
  return value.replace(/\s+/g, '');
}

/** PHP ucfirst: first character upper, rest unchanged. */
export function ucfirst(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function takeUcfirst(value: string, n: number): string {
  return ucfirst(stripSpaces(value).slice(0, n));
}

export function companyLookupBase(name: string, address1: string): string {
  return takeUcfirst(name, 4) + takeUcfirst(address1, 4);
}

export function personLookupBase(firstName: string, lastName: string, companyName: string): string {
  return takeUcfirst(firstName, 3) + takeUcfirst(lastName, 3) + takeUcfirst(companyName, 4);
}

/** SoftPro rejected the code as already taken. Local uniqueness cannot see this. */
export function isSoftProLookupCollision(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('already exist')
    || m.includes('already in use')
    || m.includes('duplicate')
    || (m.includes('lookup') && (m.includes('exist') || m.includes('taken') || m.includes('unique')))
  );
}

/**
 * SoftPro's order endpoint rejects a lookup code longer than this:
 *
 *   HTTP 400  "Value must be no longer than 10 characters."
 *
 * Their CONTACT endpoint does not enforce it — `JuaLesKell1` was accepted by
 * `CreateUser` on 2026-09-03 and then rejected by order creation seven minutes
 * later, twice. So an over-length code does not fail loudly when it is minted;
 * it fails on the first order that names the person.
 */
export const MAX_LOOKUP_CODE_LENGTH = 10;

/**
 * Append a collision suffix WITHIN the length limit, not past it.
 *
 * The old version appended without trimming: a person base is
 * 3 + 3 + 4 = exactly 10 whenever the names are long enough, so the very first
 * collision produced an 11-character code. 154 contacts carry one.
 *
 * A naive "first nine plus the digit" is not enough on its own — measured
 * against the existing 154, six of them would land on a code another contact
 * already holds. So each trimmed candidate is checked against `taken` like any
 * other, and the search continues until one is free.
 */
export function uniquifyLookupCode(base: string, existing: Iterable<string>): string {
  const taken = new Set(
    [...existing].map((c) => c.trim().toLowerCase()).filter(Boolean),
  );
  if (!base) return base;

  const capped = base.slice(0, MAX_LOOKUP_CODE_LENGTH);
  if (!taken.has(capped.toLowerCase())) return capped;

  // Bounded: the caller's vendor round-trip already handles a code SoftPro
  // rejects as duplicate, so exhausting this range is better than spinning.
  for (let n = 1; n <= 9999; n += 1) {
    const suffix = String(n);
    if (suffix.length >= MAX_LOOKUP_CODE_LENGTH) break;
    const candidate = capped.slice(0, MAX_LOOKUP_CODE_LENGTH - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return capped;
}
