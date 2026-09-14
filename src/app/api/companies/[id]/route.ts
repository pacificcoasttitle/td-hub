import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canReadContactBook } from '@/lib/security/contact-book-access';
import { getCompanyById } from '@/lib/domain/contacts/service';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { updateCompany } from '@/lib/integrations/softpro';
import { COMPANY_TYPE_MAP, DISPLAY_TO_TYPE } from '@/lib/domain/contacts/company-constants';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

/**
 * A blank field from the edit form means "not changed here" — never "erase".
 *
 * The form posts every input it has as a string, so an untouched empty input
 * arrives as `''`, not as a missing key, and `data.zip ?? existing.zip` would
 * still send the blank. The generic Companies page made that worse by
 * hard-coding `zip: ''` into every edit.
 */
function provided(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Stored company_type → the update schema's userType, for UserType fallback. */
const STORED_TYPE_TO_USER_TYPE: Record<string, 'escrow' | 'lender' | 'mortgage_broker' | 'realtor'> = {
  escrow_company: 'escrow',
  lender: 'lender',
  mortgage_broker: 'mortgage_broker',
  real_estate_company: 'realtor',
};

const updateSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200).optional().nullable().or(z.literal('')),
  phone: z.string().max(50).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(10).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  lookupCode: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
  userType: z.enum(['escrow', 'lender', 'mortgage_broker', 'realtor']).optional(),
  companyType: z.string().optional(),
}).transform(d => ({
  ...d,
  userType: d.userType ?? (d.companyType ? DISPLAY_TO_TYPE[d.companyType] : undefined),
}));

const patchSchema = z.object({
  salesRepId: z.number().int().positive().optional().nullable(),
  titleOfficerId: z.number().int().positive().optional().nullable(),
  loanUnderwriter: z.string().max(200).optional().nullable(),
  salesUnderwriter: z.string().max(200).optional().nullable(),
}).refine(d => Object.values(d).some(v => v !== undefined), {
  message: 'At least one field must be provided',
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canReadContactBook(session.role)) {
    // The master book is internal. See contact-book-access.ts.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const companyId = parseInt(id, 10);
  if (isNaN(companyId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  try {
    const company = await getCompanyById(companyId);
    if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(company);
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
  const companyId = parseInt(id, 10);
  if (isNaN(companyId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const existing = await getCompanyById(companyId);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const data = parsed.data;
    const lookupCode = existing.lookupCode ?? '';

    // ─── THE PAYLOAD IS THE STORED ROW MERGED WITH THE CHANGES ──────────────
    //
    // It used to be built from the form alone — `Address1: data.address ?? ''`
    // — and the edit form had no address field at all. SoftPro's UpdateCompany
    // replaces the whole company, so every edit erased the address SoftPro held.
    //
    // MEASURED 2026-09-12. The first company edit ever made, on Private Money
    // Solutions (Priv1503), sent `"Address1": ""` 74 seconds after the company
    // was created and got back "Company updated". SoftPro's copy had no address
    // afterwards; ours still showed 15030 Ventura Blvd because the local save
    // already fell back to the stored row. The same defect was fixed for
    // contacts on 2026-09-09 and nobody looked for it here.
    const userType = data.userType ?? STORED_TYPE_TO_USER_TYPE[existing.companyType ?? ''];
    const spUserType = userType ? (COMPANY_TYPE_MAP[userType] ?? userType) : '';
    const merged = {
      name: data.name.trim(),
      phone: provided(data.phone) ?? existing.phone ?? '',
      email: provided(data.email) ?? existing.email ?? '',
      address1: provided(data.address) ?? existing.address1 ?? '',
      city: provided(data.city) ?? existing.city ?? '',
      state: provided(data.state) ?? existing.state ?? '',
      zip: provided(data.zip) ?? existing.zip ?? '',
    };

    const spPayload = {
      Name: merged.name,
      Phone: merged.phone,
      Email: merged.email,
      LookupCode: lookupCode,
      Address1: merged.address1,
      City: merged.city,
      State: merged.state,
      Zip: merged.zip,
      ...(spUserType ? { UserType: spUserType } : {}),
    };

    const spResult = await updateCompany(spPayload);
    if (!spResult.success) {
      return NextResponse.json(
        { error: 'SoftPro UpdateCompany failed', detail: spResult.error?.message },
        { status: 502 },
      );
    }

    await db.update(companies).set({
      name: merged.name,
      email: merged.email || null,
      phone: merged.phone || null,
      address1: merged.address1 || null,
      city: merged.city || null,
      state: merged.state || null,
      zip: merged.zip || null,
      companyType: data.userType ?? existing.companyType,
      updatedAt: new Date(),
    }).where(eq(companies.id, companyId));

    return NextResponse.json({ id: companyId, lookupCode, name: merged.name });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const companyId = parseInt(id, 10);
  if (isNaN(companyId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const existing = await getCompanyById(companyId);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const data = parsed.data;
    if (data.salesRepId !== undefined) updates.salesRepId = data.salesRepId;
    if (data.titleOfficerId !== undefined) updates.titleOfficerId = data.titleOfficerId;
    if (data.loanUnderwriter !== undefined) updates.loanUnderwriter = data.loanUnderwriter;
    if (data.salesUnderwriter !== undefined) updates.salesUnderwriter = data.salesUnderwriter;

    await db.update(companies).set(updates).where(eq(companies.id, companyId));

    return NextResponse.json({ id: companyId, updated: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
