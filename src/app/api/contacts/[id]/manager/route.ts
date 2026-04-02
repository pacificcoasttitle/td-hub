import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

const setManagerSchema = z.object({
  managerId: z.number().int().positive().nullable(),
});

const assignRepsSchema = z.object({
  repIds: z.array(z.number().int().positive()),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const contactId = parseInt(id, 10);
  if (isNaN(contactId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const assignParsed = assignRepsSchema.safeParse(body);
  if (assignParsed.success) {
    const manager = await db.select({ id: contacts.id, isSalesRep: contacts.isSalesRep })
      .from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!manager[0]) return NextResponse.json({ error: 'Manager not found' }, { status: 404 });

    await db.update(contacts).set({ managerId: null, updatedAt: new Date() })
      .where(and(eq(contacts.managerId, contactId), eq(contacts.isSalesRep, true)));

    if (assignParsed.data.repIds.length > 0) {
      await db.update(contacts).set({ managerId: contactId, updatedAt: new Date() })
        .where(and(
          inArray(contacts.id, assignParsed.data.repIds),
          eq(contacts.isSalesRep, true),
        ));
    }

    return NextResponse.json({ success: true, managerId: contactId, assignedCount: assignParsed.data.repIds.length });
  }

  const setParsed = setManagerSchema.safeParse(body);
  if (setParsed.success) {
    const contact = await db.select({ id: contacts.id }).from(contacts)
      .where(eq(contacts.id, contactId)).limit(1);
    if (!contact[0]) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    if (setParsed.data.managerId) {
      const mgr = await db.select({ id: contacts.id, isSalesRep: contacts.isSalesRep })
        .from(contacts).where(eq(contacts.id, setParsed.data.managerId)).limit(1);
      if (!mgr[0]) return NextResponse.json({ error: 'Manager not found' }, { status: 404 });
    }

    await db.update(contacts).set({ managerId: setParsed.data.managerId, updatedAt: new Date() })
      .where(eq(contacts.id, contactId));

    return NextResponse.json({ success: true, contactId, managerId: setParsed.data.managerId });
  }

  return NextResponse.json({ error: 'Invalid body — provide { managerId } or { repIds }' }, { status: 400 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const contactId = parseInt(id, 10);
  if (isNaN(contactId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const managedReps = await db.select({
    id: contacts.id, fullName: contacts.fullName,
    firstName: contacts.firstName, lastName: contacts.lastName,
    email: contacts.email,
  }).from(contacts).where(and(eq(contacts.managerId, contactId), eq(contacts.isSalesRep, true)));

  return NextResponse.json({ managerId: contactId, reps: managedReps });
}
