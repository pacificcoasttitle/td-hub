import { db } from '@/lib/db/client';
import { contacts, companies } from '@/lib/db/schema';
import { eq, desc, asc, sql, ilike, or, and, SQL } from 'drizzle-orm';

// ─── Role → Boolean Flag Mapping ──────────────────────────────────────────────

function roleToBooleanFilter(role: string): SQL | null {
  switch (role) {
    case 'title_officer': return eq(contacts.isTitleOfficer, true);
    case 'escrow_officer': return eq(contacts.isEscrowOfficer, true);
    case 'sales_rep': return eq(contacts.isSalesRep, true);
    case 'agent':
    case 'selling_agent': return eq(contacts.isSellingAgent, true);
    case 'escrow': return eq(contacts.isEscrow, true);
    case 'lender': return eq(contacts.isLender, true);
    case 'mortgage_broker': return eq(contacts.isMortgageBroker, true);
    case 'underwriter': return eq(contacts.isUnderwriter, true);
    default: return null;
  }
}

function companyTypeToBooleanFilter(type: string): SQL | null {
  switch (type) {
    case 'escrow_company': return eq(companies.isEscrowCompany, true);
    case 'lender': return eq(companies.isLender, true);
    case 'mortgage_broker': return eq(companies.isMortgageBroker, true);
    case 'selling_agent': return eq(companies.isSellingAgent, true);
    case 'underwriter': return eq(companies.isUnderwriter, true);
    default: return null;
  }
}

// ─── Contact Types ───────────────────────────────────────────────────────────

export interface ContactListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string;
  active?: boolean;
  sortField?: string;
  sortDir?: 'asc' | 'desc';
}

export interface ContactListResult {
  contacts: Array<typeof contacts.$inferSelect>;
  total: number;
  page: number;
  pageSize: number;
}

// ─── Company Types ───────────────────────────────────────────────────────────

export interface CompanyListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: string;
  active?: boolean;
  sortField?: 'name' | 'companyType' | 'city' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}

export interface CompanyListResult {
  companies: Array<typeof companies.$inferSelect>;
  total: number;
  page: number;
  pageSize: number;
}

// ─── Contact Queries ─────────────────────────────────────────────────────────

export async function getContacts(params: ContactListParams = {}): Promise<ContactListResult> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];

  if (params.role) {
    const boolFilter = roleToBooleanFilter(params.role);
    if (boolFilter) {
      conditions.push(boolFilter);
    }
  }

  if (params.active !== undefined) {
    conditions.push(eq(contacts.isActive, params.active));
  }

  if (params.search) {
    const term = `%${params.search}%`;
    conditions.push(
      or(
        ilike(contacts.fullName, term),
        ilike(contacts.email, term),
        ilike(contacts.companyName, term),
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  function buildOrderBy() {
    const d = params.sortDir === 'asc' ? 'ASC' : 'DESC';
    const nl = params.sortDir === 'asc' ? 'NULLS LAST' : 'NULLS FIRST';
    switch (params.sortField) {
      case 'firstName': return sql`${contacts.firstName} ${sql.raw(d)} ${sql.raw(nl)}`;
      case 'lastName': return sql`${contacts.lastName} ${sql.raw(d)} ${sql.raw(nl)}`;
      case 'fullName': return sql`${contacts.fullName} ${sql.raw(d)} ${sql.raw(nl)}`;
      case 'email': return sql`${contacts.email} ${sql.raw(d)} ${sql.raw(nl)}`;
      default: return sql`${contacts.fullName} ASC NULLS LAST`;
    }
  }

  const [rows, countResult] = await Promise.all([
    db.select().from(contacts).where(where)
      .orderBy(buildOrderBy())
      .limit(pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(contacts).where(where),
  ]);

  return {
    contacts: rows,
    total: Number(countResult[0]?.count ?? 0),
    page,
    pageSize,
  };
}

export async function getContactById(id: number) {
  const result = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return result[0] ?? null;
}

// ─── Contact Upsert from SoftPro ─────────────────────────────────────────────

export interface UpsertContactData {
  softproLookupCode: string;
  softproFlookupCode?: string | null;
  softproUserType: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  companyName?: string | null;
  officerName?: string | null;
  email?: string | null;
  phone?: string | null;
  cell?: string | null;
  fax?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  assignmentClause?: string | null;
  licenseNo?: string | null;
  roles: string[];
}

export async function upsertContactFromSoftPro(
  data: UpsertContactData
): Promise<{ created: boolean; contactId: number }> {
  const existing = await db.select()
    .from(contacts)
    .where(eq(contacts.softproLookupCode, data.softproLookupCode))
    .limit(1);

  if (existing.length === 0) {
    const [row] = await db.insert(contacts).values({
      sourceSystem: 'softpro',
      sourceId: data.softproLookupCode,
      softproLookupCode: data.softproLookupCode,
      softproFlookupCode: data.softproFlookupCode ?? null,
      softproUserType: data.softproUserType,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      fullName: data.fullName ?? null,
      companyName: data.companyName ?? null,
      officerName: data.officerName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      cell: data.cell ?? null,
      fax: data.fax ?? null,
      address1: data.address1 ?? null,
      address2: data.address2 ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      zip: data.zip ?? null,
      assignmentClause: data.assignmentClause ?? null,
      licenseNo: data.licenseNo ?? null,
      roles: data.roles,
      isActive: true,
    }).returning({ id: contacts.id });

    return { created: true, contactId: row!.id };
  }

  const current = existing[0]!;
  const currentRoles = (current.roles ?? []) as string[];
  const mergedRoles = [...new Set([...currentRoles, ...data.roles])];

  await db.update(contacts).set({
    softproFlookupCode: data.softproFlookupCode ?? current.softproFlookupCode,
    softproUserType: data.softproUserType,
    firstName: data.firstName ?? current.firstName,
    lastName: data.lastName ?? current.lastName,
    fullName: data.fullName ?? current.fullName,
    companyName: data.companyName ?? current.companyName,
    officerName: data.officerName ?? current.officerName,
    email: data.email ?? current.email,
    phone: data.phone ?? current.phone,
    cell: data.cell ?? current.cell,
    fax: data.fax ?? current.fax,
    address1: data.address1 ?? current.address1,
    address2: data.address2 ?? current.address2,
    city: data.city ?? current.city,
    state: data.state ?? current.state,
    zip: data.zip ?? current.zip,
    assignmentClause: data.assignmentClause ?? current.assignmentClause,
    licenseNo: data.licenseNo ?? current.licenseNo,
    roles: mergedRoles,
    updatedAt: new Date(),
  }).where(eq(contacts.id, current.id));

  return { created: false, contactId: current.id };
}

// ─── Company Queries ─────────────────────────────────────────────────────────

export async function getCompanies(params: CompanyListParams = {}): Promise<CompanyListResult> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];

  if (params.type) {
    const flagFilter = companyTypeToBooleanFilter(params.type);
    if (flagFilter) {
      conditions.push(flagFilter);
    } else {
      conditions.push(eq(companies.companyType, params.type));
    }
  }

  if (params.active !== undefined) {
    conditions.push(eq(companies.isActive, params.active));
  }

  if (params.search) {
    const term = `%${params.search}%`;
    conditions.push(
      or(
        ilike(companies.name, term),
        ilike(companies.lookupCode, term),
        ilike(companies.city, term),
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const sortCol = (() => {
    switch (params.sortField) {
      case 'name': return companies.name;
      case 'companyType': return companies.companyType;
      case 'city': return companies.city;
      default: return companies.createdAt;
    }
  })();
  const orderFn = params.sortDir === 'asc' ? asc : desc;

  const [rows, countResult] = await Promise.all([
    db.select().from(companies).where(where)
      .orderBy(orderFn(sortCol))
      .limit(pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(companies).where(where),
  ]);

  return {
    companies: rows,
    total: Number(countResult[0]?.count ?? 0),
    page,
    pageSize,
  };
}

export async function getCompanyById(id: number) {
  const result = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  return result[0] ?? null;
}

// ─── Company Upsert from SoftPro ─────────────────────────────────────────────

export interface UpsertCompanyData {
  lookupCode: string;
  name: string;
  companyType: string;
  email?: string | null;
  phone?: string | null;
  fax?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  assignmentClause?: string | null;
}

export async function upsertCompanyFromSoftPro(
  data: UpsertCompanyData
): Promise<{ created: boolean; companyId: number }> {
  const existing = await db.select()
    .from(companies)
    .where(eq(companies.lookupCode, data.lookupCode))
    .limit(1);

  if (existing.length === 0) {
    const [row] = await db.insert(companies).values({
      sourceSystem: 'softpro',
      sourceId: data.lookupCode,
      lookupCode: data.lookupCode,
      name: data.name,
      companyType: data.companyType,
      email: data.email ?? null,
      phone: data.phone ?? null,
      fax: data.fax ?? null,
      address1: data.address1 ?? null,
      address2: data.address2 ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      zip: data.zip ?? null,
      assignmentClause: data.assignmentClause ?? null,
      isActive: true,
    }).returning({ id: companies.id });

    return { created: true, companyId: row!.id };
  }

  const current = existing[0]!;
  await db.update(companies).set({
    name: data.name,
    companyType: data.companyType,
    email: data.email ?? current.email,
    phone: data.phone ?? current.phone,
    fax: data.fax ?? current.fax,
    address1: data.address1 ?? current.address1,
    address2: data.address2 ?? current.address2,
    city: data.city ?? current.city,
    state: data.state ?? current.state,
    zip: data.zip ?? current.zip,
    assignmentClause: data.assignmentClause ?? current.assignmentClause,
    updatedAt: new Date(),
  }).where(eq(companies.id, current.id));

  return { created: false, companyId: current.id };
}
