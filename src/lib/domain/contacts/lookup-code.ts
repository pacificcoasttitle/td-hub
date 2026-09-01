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

export function uniquifyLookupCode(base: string, existing: Iterable<string>): string {
  const taken = new Set(
    [...existing].map((c) => c.trim().toLowerCase()).filter(Boolean),
  );
  if (!base) return base;
  if (!taken.has(base.toLowerCase())) return base;
  let n = 1;
  while (taken.has(`${base}${n}`.toLowerCase())) n += 1;
  return `${base}${n}`;
}
