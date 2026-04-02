import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getSupabaseAdmin } from '@/lib/security/supabase-admin';
import { db } from '@/lib/db/client';
import { contacts, profiles } from '@/lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

export async function POST() {
  const session = await getSession();
  if (!session || !['super_admin', 'admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reps = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, fullName: contacts.fullName, email: contacts.email })
    .from(contacts)
    .where(and(eq(contacts.isSalesRep, true), isNotNull(contacts.email)));

  const existingProfiles = await db.select({ email: profiles.email }).from(profiles);
  const existingEmails = new Set(existingProfiles.map((p) => p.email?.toLowerCase()).filter(Boolean));

  const supabase = getSupabaseAdmin();
  let created = 0;
  let skippedExists = 0;
  let skippedNoEmail = 0;
  const errors: Array<{ contactId: number; email: string; error: string }> = [];

  for (const rep of reps) {
    if (!rep.email || !rep.email.trim()) { skippedNoEmail++; continue; }
    const email = rep.email.trim().toLowerCase();
    if (existingEmails.has(email)) { skippedExists++; continue; }

    const displayName = rep.fullName ?? ([rep.firstName, rep.lastName].filter(Boolean).join(' ') || `Rep #${rep.id}`);

    try {
      const { data: user, error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });

      if (createError) {
        if (createError.message?.includes('already been registered')) {
          const { data: existingUsers } = await supabase.auth.admin.listUsers();
          const match = existingUsers?.users?.find((u) => u.email?.toLowerCase() === email);
          if (match) {
            await db.insert(profiles).values({
              id: match.id, email, displayName, role: 'sales_rep', contactId: rep.id,
            }).onConflictDoNothing();
            existingEmails.add(email);
            created++;
            continue;
          }
        }
        errors.push({ contactId: rep.id, email, error: createError.message });
        continue;
      }

      await db.insert(profiles).values({
        id: user.user.id, email, displayName, role: 'sales_rep', contactId: rep.id,
      });
      existingEmails.add(email);
      created++;
    } catch (err) {
      errors.push({ contactId: rep.id, email, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  return NextResponse.json({ created, skippedExists, skippedNoEmail, errors, totalReps: reps.length });
}
