import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getContactById } from '@/lib/domain/contacts/service';
import { updateUser } from '@/lib/integrations/softpro';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { ALL_CONTACT_TYPES, INTERNAL_TYPES } from '@/lib/domain/contacts/contact-constants';

/**
 * Lookup codes that are a UI button's text, not an identity. Lower-cased; the
 * six affected rows use three different casings of two words plus 'add'.
 */
const SUSPECT_LOOKUP_CODES = new Set(['new', 'add', 'upd', 'update', 'edit', 'save', 'submit', 'create']);

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

    // ─── A LOOKUP CODE THAT IS A BUTTON LABEL ────────────────────────────────
    //
    // Six contacts carry `New`, `NEW`, `new`, `Add`, `UPD` or `upd` in
    // softpro_lookup_code — a UI button's text landed in the identity field.
    // They arrived through the READ sync (source_system 'softpro', source_id
    // equal to the same word), between 2026-06-13 and 2026-07-12. We did not
    // write them: our first create_user call was 2026-09-01, and there was no
    // SoftPro write operation of any kind in that window.
    //
    // None of the six codes exist in SoftPro today — an 18,705-row scan of the
    // three person feeds has no match — so UpdateUser against one of them would
    // at best fail and at worst act on some other record that has since taken
    // the name. Judith Beserra ('New') is on 125 orders, so this is a live
    // contact, not a stray row.
    //
    // Refusing is the conservative move while the source is unexplained: the
    // operator gets a clear reason instead of a silent 502 or a write to the
    // wrong record. Remove this the moment the six are given real codes —
    // docs/tickets/BUTTON_LABEL_LOOKUP_CODES.md.
    if (SUSPECT_LOOKUP_CODES.has(lookupCode.trim().toLowerCase())) {
      return NextResponse.json({
        error: 'This contact cannot be edited yet',
        detail: `Its SoftPro ID is "${lookupCode}", which is a button label rather `
          + 'than a real lookup code, so an update would not reach the right record '
          + 'in SoftPro. Reported to the team — please leave this contact alone for now.',
      }, { status: 409 });
    }
    const effectiveType = data.userType ?? existing.softproUserType ?? '';
    const isInternal = INTERNAL_TYPES.has(effectiveType);

    // ─── THE PAYLOAD IS THE STORED ROW MERGED WITH THE CHANGES ──────────────
    //
    // It used to be built from the REQUEST BODY alone:
    //
    //     Address1: data.address ?? '',   Zip: data.zip ?? '',
    //
    // and the edit form had no address or zip field AT ALL — not empty,
    // absent. So every edit sent four empty strings and UpdateUser overwrote
    // whatever SoftPro held. Evidenced on contact #12058: SoftPro holds
    // "3700 Campus Drive #107, Newport Beach, CA 92660" and our row held none
    // of it. 16,297 contacts would have lost Address1 and Zip on their next
    // edit. Nothing was destroyed only because no update_user call had ever
    // run.
    //
    // THE DEFECT WAS TREATING A PARTIAL FORM AS A COMPLETE RECORD. SoftPro's
    // UpdateUser replaces the whole contact, so anything the form cannot send
    // must come from the row we already hold — which is fetched a few lines
    // above for the existence check, so this costs nothing.
    //
    // Legacy confirmed the same design: full payload every time, gaps filled
    // from their own stored row, never a diff and never a vendor read.
    //
    // `?? ''` remains only as the last resort for a field neither the form nor
    // our row has — 120 contacts today, being backfilled separately, and the
    // form now requires address/city/state/zip so no new one can be created.
    if (!isInternal) {
      const spPayload = {
        FirstName: data.firstName,
        LastName: data.lastName,
        Phone: data.phone ?? existing.phone ?? '',
        Email: data.email ?? existing.email ?? '',
        ClientLookupCode: lookupCode,
        CompanyLookupCode: data.companyLookupCode ?? existing.flookupCode ?? '',
        Address1: data.address ?? existing.address1 ?? '',
        City: data.city ?? existing.city ?? '',
        State: data.state ?? existing.state ?? '',
        Zip: data.zip ?? existing.zip ?? '',
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
