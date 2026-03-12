import { redirect } from 'next/navigation';
import { createSupabaseServer } from './supabase-server';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export type SessionUser = {
  id: string;
  email: string;
  role: string;
  displayName: string | null;
  branchId: number | null;
  contactId: number | null;
};

export async function getSession(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
  });

  if (!profile || !profile.isActive) return null;

  return {
    id: user.id,
    email: user.email ?? '',
    role: profile.role,
    displayName: profile.displayName,
    branchId: profile.branchId,
    contactId: profile.contactId,
  };
}

export async function requireAuth(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  return session;
}

export async function requireRole(allowedRoles: string[]): Promise<SessionUser> {
  const session = await requireAuth();
  if (!allowedRoles.includes(session.role)) {
    redirect('/login');
  }
  return session;
}

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

export async function requireAdmin(): Promise<SessionUser> {
  return requireRole(ADMIN_ROLES);
}
