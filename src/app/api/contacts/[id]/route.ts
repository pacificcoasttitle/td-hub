import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getContactById } from '@/lib/domain/contacts/service';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { updateUser } from '@/lib/integrations/softpro';
import { ALL_CONTACT_TYPES, INTERNAL_TYPES } from '@/lib/domain/contacts/contact-constants';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

const updateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200).optional().nullable().or(z.literal('')),
  phone: z.string().max(50).optional().nullable(),
  cell: z.string().max(50).optional().nullable(),
  companyName: z.string().max(200).optional().nullable(),
  companyLookupCode: z.string().max(100).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(10).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  licenseNo: z.string().max(50).optional().nullable(),
  isActive: z.boolean().optional(),
  userType: z.enum(ALL_CONTACT_TYPES).optional(),
  contactType: z.enum(ALL_CONTACT_TYPES).optional(),
}).transform(d => ({ ...d, userType: d.userType ?? d.contactType }));

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const contactId = parseInt(id, 10);
  if (isNaN(contactId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  try {
    const contact = await getContactById(contactId);
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(contact);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
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
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const existing = await getContactById(contactId);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const data = parsed.data;
    const fullName = `${data.lastName}, ${data.firstName}`;
    const lookupCode = existing.softproLookupCode ?? '';
    const effectiveType = data.userType ?? existing.softproUserType ?? '';
    const isInternal = INTERNAL_TYPES.has(effectiveType);

    if (!isInternal) {
      const spPayload = {
        FirstName: data.firstName,
        LastName: data.lastName,
        Phone: data.phone ?? '',
        Email: data.email ?? '',
        ClientLookupCode: lookupCode,
        CompanyLookupCode: data.companyLookupCode ?? '',
        Address1: data.address ?? '',
        City: data.city ?? '',
        State: data.state ?? '',
        Zip: data.zip ?? '',
      };

      const spResult = await updateUser(spPayload);
      if (!spResult.success) {
        return NextResponse.json(
          { error: 'SoftPro UpdateUser failed', detail: spResult.error?.message },
          { status: 502 },
        );
      }
    }

    await db.update(contacts).set({
      firstName: data.firstName,
      lastName: data.lastName,
      fullName,
      companyName: data.companyName ?? existing.companyName,
      email: (data.email && data.email !== '') ? data.email : existing.email,
      phone: data.phone ?? existing.phone,
      cell: data.cell ?? existing.cell,
      address1: data.address ?? existing.address1,
      city: data.city ?? existing.city,
      state: data.state ?? existing.state,
      zip: data.zip ?? existing.zip,
      licenseNo: data.licenseNo ?? existing.licenseNo,
      softproUserType: data.userType ?? existing.softproUserType,
      isActive: data.isActive ?? existing.isActive,
      updatedAt: new Date(),
    }).where(eq(contacts.id, contactId));

    return NextResponse.json({ id: contactId, lookupCode, fullName });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
