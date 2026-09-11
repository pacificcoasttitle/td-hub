import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies, contactCompanyLinks, contacts } from '@/lib/db/schema';
import { createUser } from '@/lib/integrations/softpro';
import { personLookupBase } from './lookup-code';
import { findSamePersonInCodeFamily, sendWithUniqueLookupCode } from './lookup-code-store';

/**
 * SoftPro person create. This module must not call addCompany.
 *
 * If CreateUser fails after a company already exists (including one just
 * created in the same wizard), the company stays. A later refactor that
 * "helpfully" retries AddCompany here would mint a second firm.
 */

export const CREATE_PERSON_USER_TYPES = [
  'escrow',
  'lender',
  'mortgage_broker',
  'realtor',
] as const;

export type CreatePersonUserType = (typeof CREATE_PERSON_USER_TYPES)[number];

export interface CreateContactInput {
  firstName: string;
  lastName: string;
  /** SoftPro CompanyLookupCode. Required. A typed company name is not a substitute. */
  companyLookupCode: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  userType: CreatePersonUserType;
}

export type CreatedContact = {
  id: number;
  lookupCode: string;
  fullName: string;
  firstName: string;
  lastName: string;
  companyName: string;
  companyLookupCode: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
};

export type KnownCompany = {
  id: number;
  lookupCode: string;
  name: string;
};

export type CreateContactResult =
  /** `reused`: the person was already held, and that record is returned instead of a new one. */
  | { ok: true; contact: CreatedContact; reused?: boolean }
  | { ok: false; code: 'COMPANY_REQUIRED'; error: string }
  | { ok: false; code: 'COMPANY_NOT_FOUND'; error: string }
  | { ok: false; code: 'VALIDATION'; error: string }
  | { ok: false; code: 'SOFTPRO'; error: string; companyKept: KnownCompany }
  | { ok: false; code: 'SOFTPRO_EXISTS'; error: string; existingLookupCode: string; companyKept: KnownCompany }
  | { ok: false; code: 'LOCAL_WRITE'; error: string; lookupCode: string; companyKept: KnownCompany };

function blankToNull(value: string | null | undefined): string | null {
  const t = value?.trim() ?? '';
  return t ? t : null;
}

function contactFlags(userType: CreatePersonUserType) {
  return {
    isEscrow: userType === 'escrow',
    isLender: userType === 'lender',
    isMortgageBroker: userType === 'mortgage_broker',
    isRealEstateAgent: userType === 'realtor',
    roles: userType === 'realtor' ? ['agent'] : [userType],
  };
}

/** Only the one flag the operator asked for — never clear another. */
function typeFlagUpdate(userType: CreatePersonUserType) {
  switch (userType) {
    case 'escrow': return { isEscrow: true };
    case 'lender': return { isLender: true };
    case 'mortgage_broker': return { isMortgageBroker: true };
    case 'realtor': return { isRealEstateAgent: true };
  }
}

export async function createContactInSoftPro(input: CreateContactInput): Promise<CreateContactResult> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName) return { ok: false, code: 'VALIDATION', error: 'First name is required' };
  if (!lastName) return { ok: false, code: 'VALIDATION', error: 'Last name is required' };

  // Company selection is required server-side. companyName is intentionally
  // not read here — typing a firm without selecting it is how legacy left
  // CompanyLookupCode empty and created unlinked people.
  const companyLookupCode = input.companyLookupCode.trim();
  if (!companyLookupCode) {
    return { ok: false, code: 'COMPANY_REQUIRED', error: 'A selected company with a lookup code is required' };
  }

  const firm = await db.select({
    id: companies.id,
    lookupCode: companies.lookupCode,
    name: companies.name,
  }).from(companies)
    .where(eq(companies.lookupCode, companyLookupCode))
    .limit(1);

  const company = firm[0];
  if (!company?.lookupCode) {
    return { ok: false, code: 'COMPANY_NOT_FOUND', error: 'Company lookup code does not match a local company' };
  }

  const companyKept: KnownCompany = {
    id: company.id,
    lookupCode: company.lookupCode,
    name: company.name,
  };

  const email = blankToNull(input.email);
  const phone = blankToNull(input.phone);
  const address1 = blankToNull(input.address);

  const base = personLookupBase(firstName, lastName, company.name);

  // ─── REUSE, DON'T DUPLICATE ────────────────────────────────────────────────
  //
  // Same email, same code family, already in our table: that is the person.
  // Return the record we hold rather than minting a suffixed copy of it. The
  // requested type flag is added so the page the operator came from finds them
  // next time — a missing flag is how Ali Darian and Chris Newcomer were hidden
  // and then created again on 2026-09-11. The held record's company stands; a
  // change of firm is an edit to that record, made deliberately.
  const existing = await findSamePersonInCodeFamily(base, email);
  if (existing) {
    await db.update(contacts).set(typeFlagUpdate(input.userType)).where(eq(contacts.id, existing.id));

    const heldCompanyCode = existing.flookupCode ?? company.lookupCode;
    const [heldCompany] = heldCompanyCode === company.lookupCode
      ? [company]
      : await db.select({ id: companies.id, lookupCode: companies.lookupCode, name: companies.name })
        .from(companies).where(eq(companies.lookupCode, heldCompanyCode)).limit(1);
    const existingFirst = existing.firstName ?? firstName;
    const existingLast = existing.lastName ?? lastName;

    return {
      ok: true,
      reused: true,
      contact: {
        id: existing.id,
        lookupCode: existing.lookupCode,
        fullName: existing.fullName ?? `${existingLast}, ${existingFirst}`,
        firstName: existingFirst,
        lastName: existingLast,
        companyName: heldCompany?.name ?? existing.companyName ?? company.name,
        companyLookupCode: heldCompanyCode,
        email: existing.email,
        phone: existing.phone,
        address: existing.address1,
        city: existing.city,
      },
    };
  }

  const pushed = await sendWithUniqueLookupCode(
    base,
    (lookupCode) => createUser({
      FirstName: firstName,
      LastName: lastName,
      Phone: phone ?? '',
      Email: email ?? '',
      ClientLookupCode: lookupCode,
      CompanyLookupCode: company.lookupCode,
      Address1: address1 ?? '',
      City: input.city?.trim() ?? '',
      State: input.state?.trim() ?? '',
      Zip: input.zip?.trim() ?? '',
    }),
    { onVendorCollision: 'refuse' },
  );

  if (!pushed.ok && pushed.existsInSoftPro) {
    return {
      ok: false,
      code: 'SOFTPRO_EXISTS',
      error: pushed.error,
      existingLookupCode: pushed.existsInSoftPro,
      companyKept,
    };
  }

  if (!pushed.ok) {
    return {
      ok: false,
      code: 'SOFTPRO',
      error: pushed.error,
      companyKept,
    };
  }
  const lookupCode = pushed.lookupCode;

  const flags = contactFlags(input.userType);
  const fullName = `${lastName}, ${firstName}`;

  try {
    const [row] = await db.insert(contacts).values({
      sourceSystem: 'softpro',
      sourceId: lookupCode,
      type: 'person',
      firstName,
      lastName,
      fullName,
      companyName: company.name,
      email,
      phone,
      address1,
      city: blankToNull(input.city),
      state: blankToNull(input.state),
      zip: blankToNull(input.zip),
      lookupCode,
      softproLookupCode: lookupCode,
      flookupCode: company.lookupCode,
      softproFlookupCode: company.lookupCode,
      softproUserType: input.userType,
      userType: input.userType,
      ...flags,
      isActive: true,
    }).returning({ id: contacts.id });

    await db.insert(contactCompanyLinks).values({
      contactId: row!.id,
      companyId: company.id,
      relationshipType: 'employee',
    });

    return {
      ok: true,
      contact: {
        id: row!.id,
        lookupCode,
        fullName,
        firstName,
        lastName,
        companyName: company.name,
        companyLookupCode: company.lookupCode,
        email,
        phone,
        address: address1,
        city: blankToNull(input.city),
      },
    };
  } catch {
    return {
      ok: false,
      code: 'LOCAL_WRITE',
      error: `Created in SoftPro as ${lookupCode}; local write failed. Do not retry create.`,
      lookupCode,
      companyKept,
    };
  }
}
