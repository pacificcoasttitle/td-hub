import { describe, expect, it, vi } from 'vitest';
import {
  isPctHubLoginEmail,
  leftoverInviteContactIds,
  loginProvisioningFromJobPayload,
  planSalesRepLoginSync,
  composeSalesRepLoginLine,
} from './sales-rep-login-policy';
import { runSalesRepLoginSync } from './sales-rep-login-sync';
import type { HubProfileRow, SalesRepContactRow } from './sales-rep-login-policy';

function contact(overrides: Partial<SalesRepContactRow> & Pick<SalesRepContactRow, 'id'>): SalesRepContactRow {
  return {
    email: null,
    fullName: null,
    firstName: null,
    lastName: null,
    isSalesRep: true,
    isActive: true,
    ...overrides,
  };
}

function profile(overrides: Partial<HubProfileRow> & Pick<HubProfileRow, 'id'>): HubProfileRow {
  return {
    email: null,
    displayName: null,
    contactId: null,
    role: 'sales_rep',
    isActive: true,
    ...overrides,
  };
}

const kennyContact = contact({
  id: 23287,
  email: 'kkessler@pct.com',
  fullName: 'Kessler, Kenny',
  firstName: 'Kenny',
  lastName: 'Kessler',
});

const marcContact = contact({
  id: 22140,
  email: 'mneveu@pct.com',
  fullName: 'Neveu, Marc',
});

const marcProfile = profile({
  id: 'marc-profile',
  email: 'mneveu@pct.com',
  displayName: 'Neveu, Marc',
  contactId: 22140,
});

const externalContact = contact({
  id: 18802,
  email: 'jane@everestescrow.com',
  fullName: 'Martinez, Jane',
});

describe('isPctHubLoginEmail', () => {
  it('accepts exactly @pct.com, case-insensitive, trimmed', () => {
    expect(isPctHubLoginEmail('kkessler@pct.com')).toBe(true);
    expect(isPctHubLoginEmail('Kkessler@PCT.COM')).toBe(true);
    expect(isPctHubLoginEmail(' kkessler@pct.com ')).toBe(true);
  });

  it('refuses everything else, including lookalikes and subdomains', () => {
    expect(isPctHubLoginEmail('jane@everestescrow.com')).toBe(false);
    expect(isPctHubLoginEmail('kkessler@pct.com.au')).toBe(false);
    expect(isPctHubLoginEmail('kkessler@mail.pct.com')).toBe(false);
    expect(isPctHubLoginEmail('kkessler@notpct.com')).toBe(false);
    expect(isPctHubLoginEmail('pct.com@evil.example')).toBe(false);
    expect(isPctHubLoginEmail('')).toBe(false);
    expect(isPctHubLoginEmail(null)).toBe(false);
  });
});

describe('planSalesRepLoginSync', () => {
  it('skips a rep who is already fully set up', () => {
    const plan = planSalesRepLoginSync({
      priorSalesRepContactIds: new Set([22140]),
      contacts: [marcContact],
      profiles: [marcProfile],
    });
    expect(plan.toInvite).toEqual([]);
    expect(plan.skippedExisting).toBe(1);
    expect(plan.toDeactivate).toEqual([]);
  });

  it("Kenny's shape is eligible when he is new this run (no profile yet)", () => {
    const plan = planSalesRepLoginSync({
      priorSalesRepContactIds: new Set(),
      contacts: [kennyContact],
      profiles: [],
    });
    expect(plan.toInvite).toEqual([{
      contactId: 23287,
      name: 'Kessler, Kenny',
      email: 'kkessler@pct.com',
    }]);
  });

  it('does not sweep the back catalogue on first run — already-flagged reps stay uninvited', () => {
    const plan = planSalesRepLoginSync({
      priorSalesRepContactIds: new Set([23287, 22140]),
      contacts: [kennyContact, marcContact],
      profiles: [marcProfile],
    });
    expect(plan.toInvite).toEqual([]);
    expect(plan.skippedExisting).toBe(1);
  });

  it('refuses an external contact even when SoftPro flags them as a sales rep', () => {
    const plan = planSalesRepLoginSync({
      priorSalesRepContactIds: new Set(),
      contacts: [externalContact],
      profiles: [],
    });
    expect(plan.toInvite).toEqual([]);
    expect(plan.refusedExternal).toEqual([{
      contactId: 18802,
      name: 'Martinez, Jane',
      email: 'jane@everestescrow.com',
    }]);
  });

  it('the domain check is what refuses them — mutate it and the same contact is invited', () => {
    const input = {
      priorSalesRepContactIds: new Set<number>(),
      contacts: [externalContact],
      profiles: [] as HubProfileRow[],
    };
    expect(planSalesRepLoginSync({ ...input, isAllowedEmail: isPctHubLoginEmail }).toInvite).toHaveLength(0);

    const mutated = planSalesRepLoginSync({ ...input, isAllowedEmail: () => true });
    expect(mutated.toInvite).toEqual([{
      contactId: 18802,
      name: 'Martinez, Jane',
      email: 'jane@everestescrow.com',
    }]);
    expect(mutated.refusedExternal).toEqual([]);
  });

  it('deactivates a hub login when the rep vanishes from SoftPro', () => {
    const departed = profile({
      id: 'gone-id',
      email: 'oldrep@pct.com',
      displayName: 'Old, Rep',
      contactId: 15003,
      isActive: true,
    });
    const plan = planSalesRepLoginSync({
      priorSalesRepContactIds: new Set([15003, 22140]),
      contacts: [
        marcContact,
        contact({ id: 15003, email: 'oldrep@pct.com', fullName: 'Old, Rep', isActive: false }),
      ],
      profiles: [marcProfile, departed],
    });
    expect(plan.toDeactivate).toEqual([{
      profileId: 'gone-id',
      contactId: 15003,
      name: 'Old, Rep',
      email: 'oldrep@pct.com',
    }]);
    expect(plan.toInvite).toEqual([]);
  });

  it('deactivates when the contact is gone from the sync entirely, and reactivates on return', () => {
    const departed = profile({
      id: 'gone-id',
      email: 'oldrep@pct.com',
      displayName: 'Old, Rep',
      contactId: 15003,
      isActive: true,
    });
    const vanished = planSalesRepLoginSync({
      priorSalesRepContactIds: new Set([15003]),
      contacts: [],
      profiles: [departed],
    });
    expect(vanished.toDeactivate).toHaveLength(1);

    const returned = planSalesRepLoginSync({
      priorSalesRepContactIds: new Set(),
      contacts: [contact({
        id: 15003,
        email: 'oldrep@pct.com',
        fullName: 'Old, Rep',
        isActive: true,
      })],
      profiles: [{ ...departed, isActive: false }],
    });
    expect(returned.toReactivate).toEqual([{
      profileId: 'gone-id',
      contactId: 15003,
      name: 'Old, Rep',
      email: 'oldrep@pct.com',
    }]);
    expect(returned.toDeactivate).toEqual([]);
    expect(returned.toInvite).toEqual([]);
  });

  it('caps invites per run and retries leftovers ahead of brand-new reps', () => {
    const contacts = Array.from({ length: 12 }, (_, i) => contact({
      id: 30000 + i,
      email: `rep${i}@pct.com`,
      fullName: `Rep ${i}`,
    }));
    const plan = planSalesRepLoginSync({
      priorSalesRepContactIds: new Set(),
      leftoverContactIds: [30011, 30010],
      contacts,
      profiles: [],
      inviteCap: 3,
    });
    expect(plan.toInvite.map((p) => p.contactId)).toEqual([30010, 30011, 30000]);
    expect(plan.capped).toHaveLength(9);
  });

  it('does not delete a profile — vanished reps are deactivate-only', () => {
    const plan = planSalesRepLoginSync({
      priorSalesRepContactIds: new Set([15003]),
      contacts: [],
      profiles: [profile({
        id: 'gone-id',
        email: 'oldrep@pct.com',
        displayName: 'Old, Rep',
        contactId: 15003,
      })],
    });
    expect(plan.toDeactivate).toHaveLength(1);
    expect(plan).not.toHaveProperty('toDelete');
  });
});

describe('runSalesRepLoginSync', () => {
  it("Kenny's case goes through the invite path and lands on linked, not created", async () => {
    const invite = vi.fn(async () => ({
      status: 'linked' as const,
      userId: '7c811a25-11b5-4d92-b4bb-e3ba560f29ee',
    }));
    const logInvite = vi.fn(async () => undefined);
    const setProfileActive = vi.fn(async () => undefined);

    const result = await runSalesRepLoginSync({
      priorSalesRepContactIds: new Set(),
      deps: {
        loadContacts: async () => [kennyContact],
        loadProfiles: async () => [],
        inviteUser: invite,
        setProfileActive,
        logInvite,
      },
    });

    expect(invite).toHaveBeenCalledWith({
      email: 'kkessler@pct.com',
      displayName: 'Kessler, Kenny',
      role: 'sales_rep',
      contactId: 23287,
    });
    expect(result.linked).toHaveLength(1);
    expect(result.invited).toHaveLength(0);
    expect(result.summary).toContain('linked Kessler, Kenny');
    expect(logInvite).toHaveBeenCalledWith(expect.objectContaining({
      email: 'kkessler@pct.com',
      status: 'linked',
    }));
    expect(setProfileActive).not.toHaveBeenCalled();
  });

  it('deactivates the vanished rep and does not invite them', async () => {
    const invite = vi.fn(async () => ({ status: 'created' as const, userId: 'x', emailed: true }));
    const setProfileActive = vi.fn(async () => undefined);
    const result = await runSalesRepLoginSync({
      priorSalesRepContactIds: new Set([15003]),
      deps: {
        loadContacts: async () => [
          contact({ id: 15003, email: 'oldrep@pct.com', fullName: 'Old, Rep', isActive: false }),
        ],
        loadProfiles: async () => [
          profile({
            id: 'gone-id',
            email: 'oldrep@pct.com',
            displayName: 'Old, Rep',
            contactId: 15003,
          }),
        ],
        inviteUser: invite,
        setProfileActive,
        logInvite: async () => undefined,
      },
    });
    expect(invite).not.toHaveBeenCalled();
    expect(setProfileActive).toHaveBeenCalledWith('gone-id', false);
    expect(result.deactivated[0]?.name).toBe('Old, Rep');
    expect(result.summary).toContain('deactivated Old, Rep');
  });

  it('never invites the external contact', async () => {
    const invite = vi.fn(async () => ({ status: 'created' as const, userId: 'x', emailed: true }));
    const result = await runSalesRepLoginSync({
      priorSalesRepContactIds: new Set(),
      deps: {
        loadContacts: async () => [externalContact],
        loadProfiles: async () => [],
        inviteUser: invite,
        setProfileActive: async () => undefined,
        logInvite: async () => undefined,
      },
    });
    expect(invite).not.toHaveBeenCalled();
    expect(result.refusedExternal).toHaveLength(1);
  });

  it('logs every capped invite so a bad sync cannot silently mail fifty people', async () => {
    const logInvite = vi.fn(async () => undefined);
    const invite = vi.fn(async () => ({ status: 'created' as const, userId: 'x', emailed: true }));
    const contacts = Array.from({ length: 12 }, (_, i) => contact({
      id: 40000 + i,
      email: `n${i}@pct.com`,
      fullName: `N${i}`,
    }));
    const result = await runSalesRepLoginSync({
      priorSalesRepContactIds: new Set(),
      deps: {
        loadContacts: async () => contacts,
        loadProfiles: async () => [],
        inviteUser: invite,
        setProfileActive: async () => undefined,
        logInvite,
        inviteCap: 2,
      },
    });
    expect(invite).toHaveBeenCalledTimes(2);
    expect(result.capped).toHaveLength(10);
    expect(logInvite).toHaveBeenCalledTimes(12);
    expect(logInvite).toHaveBeenCalledWith(expect.objectContaining({ status: 'capped' }));
  });
});

describe('ops visibility', () => {
  it('names invited, linked, and deactivated people on the job line', () => {
    const line = composeSalesRepLoginLine({
      invited: [{ contactId: 1, name: 'Phan, Jane', email: 'jphan@pct.com' }],
      linked: [{ contactId: 23287, name: 'Kessler, Kenny', email: 'kkessler@pct.com' }],
      deactivated: [{ contactId: 3, name: 'Old, Rep', email: 'oldrep@pct.com' }],
      reactivated: [],
      capped: [],
      failed: [],
    });
    expect(line).toBe(
      'Sales rep logins: invited Phan, Jane; linked Kessler, Kenny; deactivated Old, Rep.',
    );
  });

  it('reads leftover cap ids out of the previous run record', () => {
    expect(leftoverInviteContactIds({
      loginProvisioning: {
        invited: [],
        capped: [{ contactId: 40005, name: 'N5', email: 'n5@pct.com' }],
      },
    })).toEqual([40005]);
  });

  it('unwraps loginProvisioning from the jobs.payload shape the runner writes', () => {
    const parsed = loginProvisioningFromJobPayload({
      syncContacts: {
        loginProvisioning: {
          invited: [{ contactId: 1, name: 'Phan, Jane', email: 'jphan@pct.com' }],
          linked: [],
          deactivated: [],
        },
      },
    });
    expect(parsed?.invited[0]?.name).toBe('Phan, Jane');
    expect(parsed?.summary).toContain('invited Phan, Jane');
  });
});
