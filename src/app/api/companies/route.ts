import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canReadContactBook } from '@/lib/security/contact-book-access';
import { getCompanies } from '@/lib/domain/contacts/service';
import { ADD_COMPANY_USER_TYPES, DISPLAY_TO_TYPE } from '@/lib/domain/contacts/company-constants';
import { canCreateSoftProRecords } from '@/lib/domain/contacts/create-roles';
import { createCompanyInSoftPro } from '@/lib/domain/contacts/create-company';

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
  address1: z.string().max(200).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(10).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  userType: z.enum(ADD_COMPANY_USER_TYPES).optional(),
  companyType: z.string().optional(),
  confirmCreate: z.boolean().optional(),
}).transform((d) => {
  const mapped = d.userType ?? DISPLAY_TO_TYPE[d.companyType ?? ''];
  const userType = (ADD_COMPANY_USER_TYPES as readonly string[]).includes(mapped ?? '')
    ? mapped as (typeof ADD_COMPANY_USER_TYPES)[number]
    : undefined;
  return {
    ...d,
    address1: (d.address1 || d.address || '').trim(),
    userType,
  };
}).refine((d) => !!d.userType, { message: 'UserType must be Escrow Company, Lender, Mortgage Broker, or Selling Agent/Broker' })
  .refine((d) => d.address1.length > 0, { message: 'Address1 is required' });

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!canReadContactBook(session.role)) {
    // The master book is internal. See contact-book-access.ts.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
  if (!session || !canCreateSoftProRecords(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  const data = parsed.data;
  const result = await createCompanyInSoftPro({
    name: data.name,
    address1: data.address1,
    city: data.city,
    state: data.state,
    zip: data.zip,
    phone: data.phone,
    email: data.email,
    userType: data.userType!,
    confirmCreate: data.confirmCreate,
  });

  if (result.ok) {
    return NextResponse.json(result.company, { status: 201 });
  }
  if (result.code === 'VALIDATION') {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (result.code === 'EXACT_DUPLICATE' || result.code === 'NEAR_MATCH') {
    return NextResponse.json({ error: result.error, matches: result.matches, code: result.code }, { status: 409 });
  }
  if (result.code === 'SOFTPRO') {
    return NextResponse.json({ error: 'SoftPro AddCompany failed', detail: result.error }, { status: 502 });
  }
  return NextResponse.json({ error: result.error, lookupCode: result.lookupCode }, { status: 500 });
}
