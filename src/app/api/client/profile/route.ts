import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { contacts, profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, session.id))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    let contact = null;
    if (profile.contactId) {
      const [row] = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          fullName: contacts.fullName,
          companyName: contacts.companyName,
          email: contacts.email,
          phone: contacts.phone,
          cell: contacts.cell,
          address1: contacts.address1,
          city: contacts.city,
          state: contacts.state,
          zip: contacts.zip,
        })
        .from(contacts)
        .where(eq(contacts.id, profile.contactId))
        .limit(1);
      contact = row ?? null;
    }

    return NextResponse.json({
      profile: {
        id: profile.id,
        displayName: profile.displayName,
        email: profile.email,
        role: profile.role,
        branchId: profile.branchId,
        contactId: profile.contactId,
      },
      contact,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
