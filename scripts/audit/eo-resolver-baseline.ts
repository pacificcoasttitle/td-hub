/**
 * READ-ONLY. The escrow/title officer resolvers EXACTLY as they stand at
 * 46e05ee (origin/main after PR #54), copied verbatim so the replay can run the
 * old behaviour and the new behaviour side by side in one process.
 *
 * Nothing imports this but scripts/audit/eo-prefer-replay.ts. It is a frozen
 * copy on purpose: if it imported the live module it would measure the change
 * against itself.
 */

export interface BaselineContactRecord {
  id: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  officerName: string | null;
  softproLookupCode: string | null;
  sourceId: string | null;
  email: string | null;
  phone: string | null;
}

function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name.trim().toLowerCase();
}

function constructedName(c: BaselineContactRecord): string {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.join(' ').trim().toLowerCase();
}

export function baselineResolveOfficerIdByLookupCode(
  lookupCode: string | null | undefined,
  officers: BaselineContactRecord[],
): number | null {
  if (!lookupCode || !lookupCode.trim()) return null;
  const target = lookupCode.trim().toLowerCase();
  for (const o of officers) if (o.softproLookupCode?.trim().toLowerCase() === target) return o.id;
  for (const o of officers) if (o.sourceId?.trim().toLowerCase() === target) return o.id;
  return null;
}

export function baselineResolveEscrowOfficerId(
  escrowOfficer: string | null | undefined,
  officers: BaselineContactRecord[],
): number | null {
  if (!escrowOfficer || !escrowOfficer.trim()) return null;
  const target = normalizeName(escrowOfficer);
  for (const o of officers) if (normalizeName(o.officerName) === target) return o.id;
  for (const o of officers) if (normalizeName(o.fullName) === target) return o.id;
  for (const o of officers) if (constructedName(o) === target) return o.id;
  return null;
}

export function baselineResolveTitleOfficerId(
  titleOfficer: string | null | undefined,
  officers: BaselineContactRecord[],
): number | null {
  if (!titleOfficer || !titleOfficer.trim()) return null;
  const target = normalizeName(titleOfficer);
  for (const o of officers) if (normalizeName(o.officerName) === target) return o.id;
  for (const o of officers) if (constructedName(o) === target) return o.id;
  return null;
}
