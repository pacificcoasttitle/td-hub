/**
 * Who gets a hub login when the sales-rep roster syncs, and who loses one.
 *
 * Two guardrails sit above the convenience:
 *   1. Only @pct.com addresses. SoftPro can flag anyone as a marketing rep;
 *      that flag never creates an external login.
 *   2. A rep who leaves the SoftPro roster (or loses is_sales_rep) has
 *      profiles.is_active set false on the next sync. The row is not deleted.
 *
 * Invites are watermarked: only contacts that were not already sales reps
 * before this run (or leftovers held by the per-run cap) are considered.
 * The back catalogue is not mailed on first deploy.
 */

export const SALES_REP_AUTO_INVITE_CAP = 10;
export const SALES_REP_INVITE_EVENT = 'user.invite';

/** Exact domain, no subdomains, no lookalikes. */
const PCT_HUB_LOGIN_DOMAIN = '@pct.com';

export type NamedPerson = {
  contactId: number;
  name: string;
  email: string;
};

export type NamedProfile = NamedPerson & { profileId: string };

export interface SalesRepLoginSyncResult {
  invited: NamedPerson[];
  linked: NamedPerson[];
  deactivated: NamedPerson[];
  reactivated: NamedPerson[];
  refusedExternal: NamedPerson[];
  capped: NamedPerson[];
  skippedExisting: number;
  skippedNoEmail: number;
  failed: Array<NamedPerson & { error: string }>;
  summary: string;
}

export interface SalesRepContactRow {
  id: number;
  email: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  isSalesRep: boolean;
  isActive: boolean;
}

export interface HubProfileRow {
  id: string;
  email: string | null;
  displayName: string | null;
  contactId: number | null;
  role: string;
  isActive: boolean;
}

export interface SalesRepLoginPlan {
  toInvite: NamedPerson[];
  toDeactivate: NamedProfile[];
  toReactivate: NamedProfile[];
  refusedExternal: NamedPerson[];
  capped: NamedPerson[];
  skippedExisting: number;
  skippedNoEmail: number;
}

/**
 * Hub logins are PCT staff only. `user@pct.com` passes; a subdomain, a
 * lookalike, or anything else does not — including a SoftPro sales-rep flag.
 */
export function isPctHubLoginEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return false;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  if (!local || local.includes(' ') || local.includes('@')) return false;
  return domain === PCT_HUB_LOGIN_DOMAIN;
}

export function contactDisplayName(contact: {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string {
  const full = contact.fullName?.trim();
  if (full) return full;
  const parts = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  if (parts) return parts;
  const local = contact.email?.split('@')[0]?.trim();
  return local || 'Sales rep';
}

export function emptySalesRepLoginResult(): SalesRepLoginSyncResult {
  return {
    invited: [],
    linked: [],
    deactivated: [],
    reactivated: [],
    refusedExternal: [],
    capped: [],
    skippedExisting: 0,
    skippedNoEmail: 0,
    failed: [],
    summary: 'Sales rep logins: no changes.',
  };
}

export function planSalesRepLoginSync(input: {
  /** Contact ids that were already is_sales_rep BEFORE this roster write. */
  priorSalesRepContactIds: ReadonlySet<number>;
  /** Contact ids held by the previous run's invite cap, retried first. */
  leftoverContactIds?: readonly number[];
  contacts: readonly SalesRepContactRow[];
  profiles: readonly HubProfileRow[];
  inviteCap?: number;
  isAllowedEmail?: (email: string) => boolean;
}): SalesRepLoginPlan {
  const allowed = input.isAllowedEmail ?? isPctHubLoginEmail;
  const cap = input.inviteCap ?? SALES_REP_AUTO_INVITE_CAP;
  const leftover = new Set(input.leftoverContactIds ?? []);

  const activeRoster = new Set(
    input.contacts.filter((c) => c.isSalesRep && c.isActive).map((c) => c.id),
  );

  const profileByContactId = new Map<number, HubProfileRow>();
  const profileByEmail = new Map<string, HubProfileRow>();
  for (const profile of input.profiles) {
    if (profile.contactId != null && !profileByContactId.has(profile.contactId)) {
      profileByContactId.set(profile.contactId, profile);
    }
    const email = profile.email?.trim().toLowerCase();
    if (email && !profileByEmail.has(email)) profileByEmail.set(email, profile);
  }

  const toDeactivate: NamedProfile[] = [];
  const toReactivate: NamedProfile[] = [];
  for (const profile of input.profiles) {
    if (profile.role !== 'sales_rep' || profile.contactId == null) continue;
    const person = {
      profileId: profile.id,
      contactId: profile.contactId,
      name: profile.displayName?.trim() || profile.email || 'Sales rep',
      email: profile.email ?? '',
    };
    const onRoster = activeRoster.has(profile.contactId);
    if (!onRoster && profile.isActive) toDeactivate.push(person);
    if (onRoster && !profile.isActive) toReactivate.push(person);
  }

  let skippedExisting = 0;
  let skippedNoEmail = 0;
  const refusedExternal: NamedPerson[] = [];
  const eligible: NamedPerson[] = [];
  const leftoverEligible: NamedPerson[] = [];

  for (const contact of input.contacts) {
    if (!contact.isSalesRep || !contact.isActive) continue;

    const email = contact.email?.trim() ?? '';
    const person: NamedPerson = {
      contactId: contact.id,
      name: contactDisplayName(contact),
      email,
    };

    const hasProfile =
      profileByContactId.has(contact.id)
      || (email ? profileByEmail.has(email.toLowerCase()) : false);
    if (hasProfile) {
      skippedExisting++;
      continue;
    }

    if (!email) {
      skippedNoEmail++;
      continue;
    }
    if (!allowed(email)) {
      refusedExternal.push(person);
      continue;
    }

    const isNewThisRun = !input.priorSalesRepContactIds.has(contact.id);
    const isLeftover = leftover.has(contact.id);
    if (!isNewThisRun && !isLeftover) continue;

    if (isLeftover) leftoverEligible.push(person);
    else eligible.push(person);
  }

  leftoverEligible.sort((a, b) => a.contactId - b.contactId);
  eligible.sort((a, b) => a.contactId - b.contactId);
  const queue = [...leftoverEligible, ...eligible];
  const toInvite = queue.slice(0, Math.max(0, cap));
  const capped = queue.slice(Math.max(0, cap));

  return {
    toInvite,
    toDeactivate,
    toReactivate,
    refusedExternal,
    capped,
    skippedExisting,
    skippedNoEmail,
  };
}

export function composeSalesRepLoginLine(
  result: Pick<
    SalesRepLoginSyncResult,
    'invited' | 'linked' | 'deactivated' | 'reactivated' | 'capped' | 'failed'
  >,
): string | null {
  const bits: string[] = [];
  if (result.invited.length > 0) bits.push(`invited ${nameList(result.invited)}`);
  if (result.linked.length > 0) bits.push(`linked ${nameList(result.linked)}`);
  if (result.deactivated.length > 0) bits.push(`deactivated ${nameList(result.deactivated)}`);
  if (result.reactivated.length > 0) bits.push(`reactivated ${nameList(result.reactivated)}`);
  if (result.failed.length > 0) {
    bits.push(`failed for ${nameList(result.failed)}`);
  }
  if (bits.length === 0 && result.capped.length === 0) return null;
  let line = `Sales rep logins: ${bits.join('; ') || 'none processed'}`;
  if (result.capped.length > 0) {
    line += `. ${result.capped.length} more held by the per-run cap`;
  }
  return `${line}.`;
}

export function withLoginSummary(result: Omit<SalesRepLoginSyncResult, 'summary'>): SalesRepLoginSyncResult {
  return {
    ...result,
    summary: composeSalesRepLoginLine(result) ?? 'Sales rep logins: no changes.',
  };
}

function nameList(people: ReadonlyArray<{ name: string }>): string {
  const names = people.map((p) => p.name);
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function asNamedPeople(value: unknown): NamedPerson[] {
  if (!Array.isArray(value)) return [];
  const out: NamedPerson[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const contactId = Number(row.contactId);
    if (!Number.isInteger(contactId)) continue;
    out.push({
      contactId,
      name: typeof row.name === 'string' ? row.name : 'Sales rep',
      email: typeof row.email === 'string' ? row.email : '',
    });
  }
  return out;
}

export function asSalesRepLoginResult(value: unknown): SalesRepLoginSyncResult | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!('invited' in row) && !('linked' in row) && !('deactivated' in row)) return null;
  const failedRaw = Array.isArray(row.failed) ? row.failed : [];
  const failed: SalesRepLoginSyncResult['failed'] = [];
  for (const item of failedRaw) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const contactId = Number(f.contactId);
    if (!Number.isInteger(contactId)) continue;
    failed.push({
      contactId,
      name: typeof f.name === 'string' ? f.name : 'Sales rep',
      email: typeof f.email === 'string' ? f.email : '',
      error: typeof f.error === 'string' ? f.error : 'unknown',
    });
  }
  return withLoginSummary({
    invited: asNamedPeople(row.invited),
    linked: asNamedPeople(row.linked),
    deactivated: asNamedPeople(row.deactivated),
    reactivated: asNamedPeople(row.reactivated),
    refusedExternal: asNamedPeople(row.refusedExternal),
    capped: asNamedPeople(row.capped),
    skippedExisting: typeof row.skippedExisting === 'number' ? row.skippedExisting : 0,
    skippedNoEmail: typeof row.skippedNoEmail === 'number' ? row.skippedNoEmail : 0,
    failed,
  });
}

/** Jobs.payload wraps the sync result; contact_sync_state.last_result is the result itself. */
export function loginProvisioningFromJobPayload(payload: unknown): SalesRepLoginSyncResult | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  const nested = row.syncContacts;
  if (nested && typeof nested === 'object') {
    const inner = nested as Record<string, unknown>;
    if (inner.loginProvisioning) return asSalesRepLoginResult(inner.loginProvisioning);
  }
  if (row.loginProvisioning) return asSalesRepLoginResult(row.loginProvisioning);
  return asSalesRepLoginResult(row);
}

export function leftoverInviteContactIds(lastResult: unknown): number[] {
  const provisioning = loginProvisioningFromJobPayload(lastResult);
  return provisioning?.capped.map((c) => c.contactId) ?? [];
}

export function mergeSalesRepLoginResults(
  results: Array<SalesRepLoginSyncResult | null | undefined>,
): SalesRepLoginSyncResult {
  const merged = emptySalesRepLoginResult();
  const seen = {
    invited: new Set<number>(),
    linked: new Set<number>(),
    deactivated: new Set<number>(),
    reactivated: new Set<number>(),
    refusedExternal: new Set<number>(),
    capped: new Set<number>(),
    failed: new Set<number>(),
  };
  const push = (
    key: 'invited' | 'linked' | 'deactivated' | 'reactivated' | 'refusedExternal' | 'capped',
    person: NamedPerson,
  ) => {
    if (seen[key].has(person.contactId)) return;
    seen[key].add(person.contactId);
    merged[key].push(person);
  };
  for (const result of results) {
    if (!result) continue;
    for (const p of result.invited) push('invited', p);
    for (const p of result.linked) push('linked', p);
    for (const p of result.deactivated) push('deactivated', p);
    for (const p of result.reactivated) push('reactivated', p);
    for (const p of result.refusedExternal) push('refusedExternal', p);
    for (const p of result.capped) push('capped', p);
    for (const p of result.failed) {
      if (seen.failed.has(p.contactId)) continue;
      seen.failed.add(p.contactId);
      merged.failed.push(p);
    }
    merged.skippedExisting += result.skippedExisting;
    merged.skippedNoEmail += result.skippedNoEmail;
  }
  return withLoginSummary(merged);
}
