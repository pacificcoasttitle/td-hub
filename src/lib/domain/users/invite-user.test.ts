import { describe, expect, it, vi } from 'vitest';
import { inviteUser, type InviteUserDeps } from './invite-user';

const KENNY_AUTH_ID = '7c811a25-11b5-4d92-b4bb-e3ba560f29ee';

function deps(overrides: Partial<InviteUserDeps> = {}): InviteUserDeps {
  return {
    findProfile: vi.fn(async () => null),
    findAuthUserByEmail: vi.fn(async () => null),
    createAuthUser: vi.fn(async () => ({ id: 'new-auth-id' })),
    insertProfile: vi.fn(async () => undefined),
    generateMagicLink: vi.fn(async () => 'https://td-hub.pctitle.com/auth/callback?token=abc'),
    sendInviteEmail: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

describe('inviteUser', () => {
  it("Kenny's case: auth user exists, no profile — create the profile only, do not email, do not touch a password", async () => {
    const d = deps({
      findAuthUserByEmail: vi.fn(async () => ({ id: KENNY_AUTH_ID })),
    });

    const result = await inviteUser({
      email: 'kkessler@pct.com',
      displayName: 'Kessler, Kenny',
      role: 'sales_rep',
      contactId: 23287,
    }, d);

    expect(result).toEqual({ status: 'linked', userId: KENNY_AUTH_ID });
    expect(d.createAuthUser).not.toHaveBeenCalled();
    expect(d.generateMagicLink).not.toHaveBeenCalled();
    expect(d.sendInviteEmail).not.toHaveBeenCalled();
    expect(d.insertProfile).toHaveBeenCalledWith({
      id: KENNY_AUTH_ID,
      email: 'kkessler@pct.com',
      displayName: 'Kessler, Kenny',
      role: 'sales_rep',
      branchId: null,
      contactId: 23287,
    });
  });

  it('does not call createAuthUser with a password on a full invite either', async () => {
    const d = deps();
    await inviteUser({
      email: 'newrep@pct.com',
      displayName: 'New Rep',
      role: 'sales_rep',
      contactId: 99,
    }, d);
    expect(d.createAuthUser).toHaveBeenCalledWith({ email: 'newrep@pct.com', displayName: 'New Rep' });
    const arg = (d.createAuthUser as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('password');
  });

  it('full invite: create auth, write profile, send the set-password email', async () => {
    const d = deps();
    const result = await inviteUser({
      email: 'NewRep@pct.com',
      displayName: 'Phan, Jane',
      role: 'sales_rep',
      contactId: 24001,
    }, d);

    expect(result).toEqual({ status: 'created', userId: 'new-auth-id', emailed: true });
    expect(d.createAuthUser).toHaveBeenCalledTimes(1);
    expect(d.insertProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: 'new-auth-id',
      email: 'newrep@pct.com',
      role: 'sales_rep',
      contactId: 24001,
    }));
    expect(d.generateMagicLink).toHaveBeenCalledWith('newrep@pct.com');
    expect(d.sendInviteEmail).toHaveBeenCalledTimes(1);
  });

  it('profile already exists → skip, do not recut a password or re-send', async () => {
    const d = deps({
      findProfile: vi.fn(async () => ({ id: 'already-there' })),
    });
    const result = await inviteUser({
      email: 'mneveu@pct.com',
      displayName: 'Neveu, Marc',
      role: 'sales_rep',
      contactId: 22140,
    }, d);
    expect(result).toEqual({ status: 'exists', userId: 'already-there' });
    expect(d.createAuthUser).not.toHaveBeenCalled();
    expect(d.insertProfile).not.toHaveBeenCalled();
    expect(d.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('createUser saying already registered falls through to link, not an error', async () => {
    const d = deps({
      createAuthUser: vi.fn(async () => ({ alreadyRegistered: true as const })),
      findAuthUserByEmail: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: KENNY_AUTH_ID }),
    });
    const result = await inviteUser({
      email: 'kkessler@pct.com',
      displayName: 'Kessler, Kenny',
      role: 'sales_rep',
      contactId: 23287,
    }, d);
    expect(result).toEqual({ status: 'linked', userId: KENNY_AUTH_ID });
    expect(d.sendInviteEmail).not.toHaveBeenCalled();
  });
});
