import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts, notificationLogs, profiles } from '@/lib/db/schema';
import { inviteUser, type InviteUserResult } from '@/lib/domain/users/invite-user';
import {
  SALES_REP_AUTO_INVITE_CAP,
  SALES_REP_INVITE_EVENT,
  emptySalesRepLoginResult,
  planSalesRepLoginSync,
  withLoginSummary,
  type HubProfileRow,
  type NamedPerson,
  type SalesRepContactRow,
  type SalesRepLoginSyncResult,
} from '@/lib/domain/users/sales-rep-login-policy';

export {
  SALES_REP_AUTO_INVITE_CAP,
  composeSalesRepLoginLine,
  isPctHubLoginEmail,
  leftoverInviteContactIds,
  loginProvisioningFromJobPayload,
  mergeSalesRepLoginResults,
  planSalesRepLoginSync,
} from '@/lib/domain/users/sales-rep-login-policy';
export type { SalesRepLoginSyncResult } from '@/lib/domain/users/sales-rep-login-policy';

export interface SalesRepLoginSyncDeps {
  loadContacts: () => Promise<SalesRepContactRow[]>;
  loadProfiles: () => Promise<HubProfileRow[]>;
  inviteUser: (input: {
    email: string;
    displayName: string;
    role: 'sales_rep';
    contactId: number;
  }) => Promise<InviteUserResult>;
  setProfileActive: (profileId: string, isActive: boolean) => Promise<void>;
  logInvite: (entry: {
    email: string;
    name: string;
    contactId: number;
    status: string;
    errorMessage?: string;
  }) => Promise<void>;
  isAllowedEmail?: (email: string) => boolean;
  inviteCap?: number;
}

export async function listSalesRepContactIds(): Promise<number[]> {
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.isSalesRep, true));
  return rows.map((r) => r.id);
}

export async function runSalesRepLoginSync(input: {
  priorSalesRepContactIds: ReadonlySet<number>;
  leftoverContactIds?: readonly number[];
  deps?: Partial<SalesRepLoginSyncDeps>;
}): Promise<SalesRepLoginSyncResult> {
  const deps = { ...defaultSalesRepLoginSyncDeps(), ...input.deps };
  const [contactRows, profileRows] = await Promise.all([
    deps.loadContacts(),
    deps.loadProfiles(),
  ]);

  const plan = planSalesRepLoginSync({
    priorSalesRepContactIds: input.priorSalesRepContactIds,
    leftoverContactIds: input.leftoverContactIds,
    contacts: contactRows,
    profiles: profileRows,
    inviteCap: deps.inviteCap,
    isAllowedEmail: deps.isAllowedEmail,
  });

  for (const person of plan.toDeactivate) {
    await deps.setProfileActive(person.profileId, false);
  }
  for (const person of plan.toReactivate) {
    await deps.setProfileActive(person.profileId, true);
  }

  const invited: NamedPerson[] = [];
  const linked: NamedPerson[] = [];
  const failed: SalesRepLoginSyncResult['failed'] = [];
  let skippedExisting = plan.skippedExisting;

  for (const person of plan.toInvite) {
    const outcome = await deps.inviteUser({
      email: person.email,
      displayName: person.name,
      role: 'sales_rep',
      contactId: person.contactId,
    });
    if (outcome.status === 'created') {
      invited.push(person);
      await deps.logInvite({
        email: person.email,
        name: person.name,
        contactId: person.contactId,
        status: outcome.emailed ? 'sent' : 'failed',
        errorMessage: outcome.emailed ? undefined : 'Invite email did not send',
      });
    } else if (outcome.status === 'linked') {
      linked.push(person);
      await deps.logInvite({
        email: person.email,
        name: person.name,
        contactId: person.contactId,
        status: 'linked',
      });
    } else if (outcome.status === 'exists') {
      skippedExisting++;
    } else {
      failed.push({ ...person, error: outcome.error });
      await deps.logInvite({
        email: person.email,
        name: person.name,
        contactId: person.contactId,
        status: 'failed',
        errorMessage: outcome.error,
      });
    }
  }

  for (const person of plan.capped) {
    await deps.logInvite({
      email: person.email,
      name: person.name,
      contactId: person.contactId,
      status: 'capped',
      errorMessage: `Held by the per-run cap of ${deps.inviteCap ?? SALES_REP_AUTO_INVITE_CAP}`,
    });
  }

  return withLoginSummary({
    invited,
    linked,
    deactivated: plan.toDeactivate,
    reactivated: plan.toReactivate,
    refusedExternal: plan.refusedExternal,
    capped: plan.capped,
    skippedExisting,
    skippedNoEmail: plan.skippedNoEmail,
    failed,
  });
}

function defaultSalesRepLoginSyncDeps(): SalesRepLoginSyncDeps {
  return {
    async loadContacts() {
      return db
        .select({
          id: contacts.id,
          email: contacts.email,
          fullName: contacts.fullName,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          isSalesRep: contacts.isSalesRep,
          isActive: contacts.isActive,
        })
        .from(contacts)
        .where(eq(contacts.isSalesRep, true));
    },

    async loadProfiles() {
      return db
        .select({
          id: profiles.id,
          email: profiles.email,
          displayName: profiles.displayName,
          contactId: profiles.contactId,
          role: profiles.role,
          isActive: profiles.isActive,
        })
        .from(profiles);
    },

    async inviteUser(input) {
      return inviteUser(input);
    },

    async setProfileActive(profileId, isActive) {
      await db
        .update(profiles)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(profiles.id, profileId));
    },

    async logInvite(entry) {
      await db.insert(notificationLogs).values({
        eventType: SALES_REP_INVITE_EVENT,
        channel: 'email',
        recipientEmail: entry.email,
        recipientName: entry.name,
        recipientRole: 'sales_rep',
        status: entry.status,
        errorMessage: entry.errorMessage ?? null,
        metadata: { contactId: entry.contactId, source: 'sales_rep_sync' },
        sentAt: entry.status === 'sent' ? new Date() : null,
      });
    },
  };
}

export function failedLoginSyncResult(error: string): SalesRepLoginSyncResult {
  const empty = emptySalesRepLoginResult();
  return withLoginSummary({
    ...empty,
    failed: [{ contactId: 0, name: 'sales-rep login sync', email: '', error }],
  });
}
