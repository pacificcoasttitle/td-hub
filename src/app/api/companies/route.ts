import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getCompanies } from '@/lib/domain/contacts/service';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema';
import { addCompany } from '@/lib/integrations/softpro';
import { COMPANY_TYPE_MAP, DISPLAY_TO_TYPE } from '@/lib/domain/contacts/company-constants';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  search: z.string().optional(),
  type: z.string().optional(),
  active: z.string().optional(),
  sortField: z.enum(['name', 'companyType', 'city', 'createdAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

const createSchema = z.object({
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
  userType: d.userType ?? DISPLAY_TO_TYPE[d.companyType ?? ''] ?? 'escrow',
}));

function generateCompanyLookupCode(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 10);
  const ts = Date.now().toString(36).slice(-4);
  const code = clean + ts;
  return code.length >= 10 ? code : code.padEnd(10, '0');
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const params = querySchema.parse(rawParams);

    const result = await getCompanies({
      ...params,
      active: params.active === 'true' ? true : params.active === 'false' ? false : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  const data = parsed.data;
  const lookupCode = generateCompanyLookupCode(data.name);
  const spUserType = COMPANY_TYPE_MAP[data.userType] ?? data.userType;

  const spPayload = {
    Name: data.name,
    Phone: data.phone ?? '',
    Email: data.email ?? '',
    LookupCode: lookupCode,
    Address1: data.address ?? '',
    City: data.city ?? '',
    State: data.state ?? '',
    Zip: data.zip ?? '',
    UserType: spUserType,
  };

  try {
    const spResult = await addCompany(spPayload);
    if (!spResult.success) {
      return NextResponse.json(
        { error: 'SoftPro AddCompany failed', detail: spResult.error?.message },
        { status: 502 },
      );
    }

    const [row] = await db.insert(companies).values({
      sourceSystem: 'softpro',
      sourceId: lookupCode,
      name: data.name,
      companyType: data.userType,
      lookupCode,
      email: data.email ?? null,
      phone: data.phone ?? null,
      address1: data.address ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      zip: data.zip ?? null,
      isActive: true,
    }).returning({ id: companies.id });

    return NextResponse.json({ id: row!.id, lookupCode, name: data.name }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
