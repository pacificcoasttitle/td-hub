import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getCompanyById } from '@/lib/domain/contacts/service';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { updateCompany } from '@/lib/integrations/softpro';
import { COMPANY_TYPE_MAP, DISPLAY_TO_TYPE } from '@/lib/domain/contacts/company-constants';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

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
    const spUserType = data.userType ? (COMPANY_TYPE_MAP[data.userType] ?? data.userType) : '';

    const spPayload = {
      Name: data.name,
      Phone: data.phone ?? '',
      Email: data.email ?? '',
      LookupCode: lookupCode,
      Address1: data.address ?? '',
      City: data.city ?? '',
      State: data.state ?? '',
      Zip: data.zip ?? '',
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
      name: data.name,
      email: data.email ?? existing.email,
      phone: data.phone ?? existing.phone,
      address1: data.address ?? existing.address1,
      city: data.city ?? existing.city,
      state: data.state ?? existing.state,
      zip: data.zip ?? existing.zip,
      companyType: data.userType ?? existing.companyType,
      updatedAt: new Date(),
    }).where(eq(companies.id, companyId));

    return NextResponse.json({ id: companyId, lookupCode, name: data.name });
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
