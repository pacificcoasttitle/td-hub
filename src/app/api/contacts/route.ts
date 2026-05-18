import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getContacts } from '@/lib/domain/contacts/service';
import { db } from '@/lib/db/client';
import { contacts, profiles } from '@/lib/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { createUser } from '@/lib/integrations/softpro';
import { ALL_CONTACT_TYPES, INTERNAL_TYPES } from '@/lib/domain/contacts/contact-constants';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(500).default(25),
  search: z.string().optional(),
  role: z.string().optional(),
  type: z.string().optional(),
  scope: z.enum(['internal', 'external', 'all']).optional(),
  active: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const USER_TYPE_ROLES: Record<string, string[]> = {
  escrow: ['escrow_officer'],
  lender: ['lender'],
  mortgage_broker: ['mortgage_broker'],
  realtor: ['agent'],
};

const createSchema = z.object({
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
  isActive: z.boolean().optional().default(true),
  userType: z.enum(ALL_CONTACT_TYPES).optional(),
  contactType: z.enum(ALL_CONTACT_TYPES).optional(),
}).transform(d => ({ ...d, userType: d.userType ?? d.contactType ?? 'realtor' }));

function generateLookupCode(firstName: string, lastName: string, companyName?: string | null): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const base = clean(lastName).slice(0, 6) + clean(firstName).slice(0, 4);
  const companySuffix = companyName ? clean(companyName).slice(0, 4) : '';
  const ts = Date.now().toString(36).slice(-4);
  const code = (base + companySuffix + ts).slice(0, 20);
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

    const scope = params.scope === 'all' ? undefined : params.scope;

    const result = await getContacts({
      ...params,
      role: params.role ?? params.type,
      scope,
      active: params.active === 'true' ? true : params.active === 'false' ? false : undefined,
      sortField: params.sort,
      sortDir: params.order,
    });

    const effectiveType = params.type ?? params.role;
    if (effectiveType === 'sales_rep' && result.contacts.length > 0) {
      const pageIds = result.contacts.map((c) => c.id);
      const mgrIds = result.contacts.map((c) => c.managerId).filter((v): v is number => v != null);

      const [managers, managedCounts, profileRows] = await Promise.all([
        mgrIds.length > 0
          ? db.select({ id: contacts.id, fullName: contacts.fullName }).from(contacts).where(inArray(contacts.id, mgrIds))
          : Promise.resolve([]),
        db.select({ managerId: contacts.managerId, count: sql<number>`count(*)` })
          .from(contacts)
          .where(and(inArray(contacts.managerId, pageIds), eq(contacts.isSalesRep, true)))
          .groupBy(contacts.managerId),
        db.select({ contactId: profiles.contactId, role: profiles.role })
          .from(profiles)
          .where(inArray(profiles.contactId, pageIds)),
      ]);

      const mgrMap = Object.fromEntries(managers.map((m) => [m.id, m.fullName]));
      const countMap = Object.fromEntries(managedCounts.map((r) => [r.managerId!, Number(r.count)]));
      const roleMap = Object.fromEntries(profileRows.filter(r => r.contactId != null).map(r => [r.contactId!, r.role]));

      const enriched = result.contacts.map((c) => ({
        ...c,
        managerName: c.managerId ? (mgrMap[c.managerId] ?? null) : null,
        managedRepCount: countMap[c.id] ?? 0,
        profileRole: roleMap[c.id] ?? null,
      }));

      return NextResponse.json({ ...result, contacts: enriched });
    }

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
  const lookupCode = generateLookupCode(data.firstName, data.lastName, data.companyName);
  const fullName = `${data.lastName}, ${data.firstName}`;
  const isInternal = INTERNAL_TYPES.has(data.userType);

  try {
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

      const spResult = await createUser(spPayload);
      if (!spResult.success) {
        return NextResponse.json(
          { error: 'SoftPro CreateUser failed', detail: spResult.error?.message },
          { status: 502 },
        );
      }
    }

    const roles = USER_TYPE_ROLES[data.userType] ?? [data.userType];

    const [row] = await db.insert(contacts).values({
      sourceSystem: isInternal ? 'manual' : 'softpro',
      sourceId: lookupCode,
      firstName: data.firstName,
      lastName: data.lastName,
      fullName,
      companyName: data.companyName ?? null,
      email: (data.email && data.email !== '') ? data.email : null,
      phone: data.phone ?? null,
      cell: data.cell ?? null,
      address1: data.address ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      zip: data.zip ?? null,
      licenseNo: data.licenseNo ?? null,
      softproLookupCode: lookupCode,
      softproUserType: data.userType,
      roles,
      isActive: data.isActive ?? true,
    }).returning({ id: contacts.id });

    return NextResponse.json({ id: row!.id, lookupCode, fullName }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
