import { eq, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { getSupabaseAdmin } from '@/lib/security/supabase-admin';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import { buildInviteHtml, buildInviteSubject } from '@/lib/domain/notifications/invite-email';

export const INVITE_ROLES = [
  'super_admin', 'admin', 'cs_admin', 'sales_manager',
  'sales_rep', 'title_officer', 'escrow_officer',
  'open_order_team', 'escrow_assistant', 'title_production', 'client',
] as const;

export type InviteRole = typeof INVITE_ROLES[number];

export interface InviteUserInput {
  email: string;
  displayName: string;
  role: InviteRole;
  branchId?: number | null;
  contactId?: number | null;
}

export type InviteUserResult =
  | { status: 'created'; userId: string; emailed: boolean }
  | { status: 'linked'; userId: string }
  | { status: 'exists'; userId?: string }
  | { status: 'error'; error: string };

export interface InviteUserDeps {
  findProfile: (email: string, contactId?: number | null) => Promise<{ id: string } | null>;
  findAuthUserByEmail: (email: string) => Promise<{ id: string } | null>;
  createAuthUser: (input: { email: string; displayName: string }) => Promise<
    { id: string } | { alreadyRegistered: true } | { error: string }
  >;
  insertProfile: (row: {
    id: string;
    email: string;
    displayName: string;
    role: InviteRole;
    branchId: number | null;
    contactId: number | null;
  }) => Promise<void>;
  generateMagicLink: (email: string) => Promise<string | null>;
  sendInviteEmail: (input: {
    email: string;
    displayName: string;
    role: InviteRole;
    magicLink: string | null;
  }) => Promise<{ success: boolean }>;
}

const ALREADY_REGISTERED = /already been registered|already registered/i;

export function normaliseInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The /api/admin/invite-user path, as a function.
 *
 * Three cases, never touching a password:
 *   profile exists            → exists (skip)
 *   auth user, no profile     → insert the profiles row only (Kenny)
 *   neither                   → createUser + profile + set-password email
 */
export async function inviteUser(
  input: InviteUserInput,
  deps: InviteUserDeps = defaultInviteUserDeps(),
): Promise<InviteUserResult> {
  const email = normaliseInviteEmail(input.email);
  const displayName = input.displayName.trim();
  const contactId = input.contactId ?? null;
  const branchId = input.branchId ?? null;

  if (!email || !displayName) {
    return { status: 'error', error: 'Email and display name are required' };
  }

  const existingProfile = await deps.findProfile(email, contactId);
  if (existingProfile) {
    return { status: 'exists', userId: existingProfile.id };
  }

  const existingAuth = await deps.findAuthUserByEmail(email);
  if (existingAuth) {
    await deps.insertProfile({
      id: existingAuth.id,
      email,
      displayName,
      role: input.role,
      branchId,
      contactId,
    });
    return { status: 'linked', userId: existingAuth.id };
  }

  const created = await deps.createAuthUser({ email, displayName });
  if ('error' in created) return { status: 'error', error: created.error };

  let userId: string;
  if ('alreadyRegistered' in created) {
    const found = await deps.findAuthUserByEmail(email);
    if (!found) {
      return { status: 'error', error: 'Auth user already registered but could not be looked up' };
    }
    userId = found.id;
    await deps.insertProfile({
      id: userId,
      email,
      displayName,
      role: input.role,
      branchId,
      contactId,
    });
    return { status: 'linked', userId };
  }

  userId = created.id;
  await deps.insertProfile({
    id: userId,
    email,
    displayName,
    role: input.role,
    branchId,
    contactId,
  });

  const magicLink = await deps.generateMagicLink(email);
  const sent = await deps.sendInviteEmail({
    email,
    displayName,
    role: input.role,
    magicLink,
  });
  return { status: 'created', userId, emailed: sent.success };
}

export function defaultInviteUserDeps(): InviteUserDeps {
  return {
    async findProfile(email, contactId) {
      const clauses = [sql`lower(${profiles.email}) = ${email}`];
      if (contactId != null) clauses.push(eq(profiles.contactId, contactId));
      const [row] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(clauses.length === 1 ? clauses[0]! : or(...clauses))
        .limit(1);
      return row ?? null;
    },

    async findAuthUserByEmail(email) {
      const supabase = getSupabaseAdmin();
      for (let page = 1; page <= 5; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(error.message);
        const match = data.users.find((u) => u.email?.toLowerCase() === email);
        if (match) return { id: match.id };
        if (data.users.length < 1000) return null;
      }
      return null;
    },

    async createAuthUser({ email, displayName }) {
      const supabase = getSupabaseAdmin();
      // No password on purpose. The magic-link email is how they set one.
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        email_confirm: false,
        user_metadata: { display_name: displayName },
      });
      if (error) {
        if (ALREADY_REGISTERED.test(error.message)) return { alreadyRegistered: true as const };
        return { error: error.message };
      }
      if (!data.user) return { error: 'Auth createUser returned no user' };
      return { id: data.user.id };
    },

    async insertProfile(row) {
      await db.insert(profiles).values(row);
    },

    async generateMagicLink(email) {
      try {
        const supabase = getSupabaseAdmin();
        const { data } = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
        return data?.properties?.action_link ?? null;
      } catch {
        return null;
      }
    },

    async sendInviteEmail({ email, displayName, role, magicLink }) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://td-hub.pctitle.com';
      const result = await sendEmail({
        to: email,
        subject: buildInviteSubject(),
        html: buildInviteHtml(displayName, role, magicLink, appUrl),
      });
      return { success: result.success };
    },
  };
}
