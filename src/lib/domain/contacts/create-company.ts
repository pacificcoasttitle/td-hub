import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema';
import { addCompany } from '@/lib/integrations/softpro';
import {
  ADD_COMPANY_USER_TYPE,
  companyTypeFlags,
  persistCompanyType,
  type AddCompanyUserType,
} from './company-constants';
import { rankFirmMatches, type ScoredFirm } from './company-near-match';
import { companyLookupBase } from './lookup-code';
import { sendWithUniqueLookupCode } from './lookup-code-store';

export interface CreateCompanyInput {
  name: string;
  address1: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  userType: AddCompanyUserType;
  /** Required when near matches exist. Exact name+address is never creatable. */
  confirmCreate?: boolean;
}

export type CreatedCompany = {
  id: number;
  lookupCode: string;
  name: string;
  address1: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
};

export type CreateCompanyResult =
  | { ok: true; company: CreatedCompany }
  | { ok: false; code: 'VALIDATION'; error: string }
  | { ok: false; code: 'EXACT_DUPLICATE'; error: string; matches: ScoredFirm[] }
  | { ok: false; code: 'NEAR_MATCH'; error: string; matches: ScoredFirm[] }
  | { ok: false; code: 'SOFTPRO'; error: string }
  | { ok: false; code: 'LOCAL_WRITE'; error: string; lookupCode: string };

function blankToNull(value: string | null | undefined): string | null {
  const t = value?.trim() ?? '';
  return t ? t : null;
}

export async function findNearCompanies(query: {
  name: string;
  address1?: string;
  city?: string;
}): Promise<ScoredFirm[]> {
  const name = query.name.trim();
  if (name.length < 2) return [];
  const escaped = name.replace(/[%_\\]/g, '\\$&');
  const firstToken = name.split(/\s+/).find((t) => t.length >= 3) ?? name;
  const tokenEscaped = firstToken.replace(/[%_\\]/g, '\\$&');

  const rows = await db.select({
    id: companies.id,
    name: companies.name,
    lookupCode: companies.lookupCode,
    address1: companies.address1,
    city: companies.city,
    state: companies.state,
    zip: companies.zip,
    phone: companies.phone,
    email: companies.email,
  }).from(companies).where(and(
    eq(companies.isActive, true),
    or(
      sql`${companies.name} ILIKE ${`%${escaped}%`} ESCAPE '\\'`,
      sql`${companies.name} ILIKE ${`%${tokenEscaped}%`} ESCAPE '\\'`,
      query.address1?.trim()
        ? ilike(companies.address1, `%${query.address1.trim().replace(/[%_\\]/g, '\\$&')}%`)
        : sql`false`,
    ),
  )).limit(40);

  return rankFirmMatches(query, rows).slice(0, 8);
}

export async function createCompanyInSoftPro(input: CreateCompanyInput): Promise<CreateCompanyResult> {
  const name = input.name.trim();
  const address1 = input.address1.trim();
  if (!name) return { ok: false, code: 'VALIDATION', error: 'Company name is required' };
  if (!address1) return { ok: false, code: 'VALIDATION', error: 'Address1 is required' };

  const userType = input.userType;
  const spUserType = ADD_COMPANY_USER_TYPE[userType];
  if (!spUserType) {
    return { ok: false, code: 'VALIDATION', error: 'UserType must be Escrow Company, Lender, Mortgage Broker, or Selling Agent/Broker' };
  }

  const matches = await findNearCompanies({
    name,
    address1,
    city: input.city ?? undefined,
  });
  const exact = matches.filter((m) => m.reason === 'exact_name_address');
  if (exact.length > 0) {
    return {
      ok: false,
      code: 'EXACT_DUPLICATE',
      error: 'A company with this name and address already exists',
      matches: exact,
    };
  }
  if (matches.length > 0 && !input.confirmCreate) {
    return {
      ok: false,
      code: 'NEAR_MATCH',
      error: 'Similar companies already exist — select one or confirm create',
      matches,
    };
  }

  const email = blankToNull(input.email);
  const phone = blankToNull(input.phone);

  const pushed = await sendWithUniqueLookupCode(
    companyLookupBase(name, address1),
    (lookupCode) => addCompany({
      Name: name,
      Phone: phone ?? '',
      Email: email ?? '',
      LookupCode: lookupCode,
      Address1: address1,
      City: input.city?.trim() ?? '',
      State: input.state?.trim() ?? '',
      Zip: input.zip?.trim() ?? '',
      UserType: spUserType,
    }),
  );

  if (!pushed.ok) {
    return { ok: false, code: 'SOFTPRO', error: pushed.error };
  }
  const lookupCode = pushed.lookupCode;

  const flags = companyTypeFlags(userType);
  try {
    const [row] = await db.insert(companies).values({
      sourceSystem: 'softpro',
      sourceId: lookupCode,
      name,
      companyType: persistCompanyType(userType),
      lookupCode,
      email,
      phone,
      address1,
      city: blankToNull(input.city),
      state: blankToNull(input.state),
      zip: blankToNull(input.zip),
      ...flags,
      isActive: true,
    }).returning({
      id: companies.id,
      lookupCode: companies.lookupCode,
      name: companies.name,
      address1: companies.address1,
      city: companies.city,
      phone: companies.phone,
      email: companies.email,
    });

    return {
      ok: true,
      company: {
        id: row!.id,
        lookupCode: row!.lookupCode ?? lookupCode,
        name: row!.name,
        address1: row!.address1,
        city: row!.city,
        phone: row!.phone,
        email: row!.email,
      },
    };
  } catch {
    return {
      ok: false,
      code: 'LOCAL_WRITE',
      error: `Created in SoftPro as ${lookupCode}; local write failed. Do not retry create.`,
      lookupCode,
    };
  }
}
