import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getContactById } from '@/lib/domain/contacts/service';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
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

    // ─── EDITS THAT PUSH TO SOFTPRO ARE BLOCKED ─────────────────────────────
    //
    // The payload here was built from the REQUEST BODY, and the edit form has
    // no address or zip field AT ALL — not empty, absent. So `data.address` was
    // undefined on every request, `?? ''` made it an empty string, and
    // UpdateUser overwrote whatever SoftPro held with nothing.
    //
    // Evidenced on contact #12058, read from SoftPro's own lookup table:
    //   Address1 "3700 Campus Drive #107"  City "Newport Beach"  Zip "92660"
    // and our row holds none of it. 16,297 contacts push on edit, and every one
    // would lose Address1 and Zip — plus City on 137 and State on 133 where our
    // row is also empty.
    //
    // Nothing has been destroyed. There is no `update_user` call in the log,
    // all time — this blocks the path before the first one. The edit button was
    // made visible on 2026-09-09, which turned a latent path into a one-click
    // one; that is what made this urgent rather than theoretical.
    //
    // THE FIX is read-modify-write: fetch SoftPro's current record, merge the
    // changed fields into it, send everything else back byte-for-byte. Until
    // that lands, an edit that would push is refused rather than silently
    // destructive.
    //
    // Internal types (title_officer, escrow_officer, sales_rep) never pushed,
    // so those edits are untouched and still work.
    if (!isInternal) {
      return NextResponse.json({
        error: 'Editing this contact is temporarily disabled.',
        detail: 'Saving would erase the address SoftPro holds for this contact. '
          + 'See docs/tickets/CONTACT_EDIT_BLANKS_SOFTPRO_ADDRESS.md',
      }, { status: 503 });
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
