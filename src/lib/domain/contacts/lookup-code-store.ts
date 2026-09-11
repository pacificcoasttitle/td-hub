import { or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies, contacts } from '@/lib/db/schema';
import { isInLookupCodeFamily, isSoftProLookupCollision, MAX_LOOKUP_CODE_LENGTH, uniquifyLookupCode } from './lookup-code';

export const LOOKUP_PUSH_MAX_ATTEMPTS = 5;

function likePrefix(base: string): string {
  return `${base.replace(/[%_\\]/g, '\\$&')}%`;
}

export interface ExistingPerson {
  id: number;
  lookupCode: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  address1: string | null;
  city: string | null;
  flookupCode: string | null;
  companyName: string | null;
}

/**
 * An ACTIVE person in our table whose email matches and whose lookup code is in
 * the same family as `base` — the same person, already held.
 *
 * WHY. On 2026-09-11 Chris Newcomer (`ChrNewNewc`) and Ali Darian
 * (`AliDarGuar`) were already in this table, hidden from the Parties picker by
 * their type flags. allocateLookupCode saw each code as taken and minted
 * `ChrNewNewc1` and `AliDarGuar1` without asking whether the holder was the
 * same person. SoftPro was never even asked about the original code.
 *
 * A matching email is the test. It is compared case-insensitively, and names
 * are deliberately not compared: SoftPro holds "Christopher", the operator
 * typed "Chris".
 *
 * When several match, the one whose code SoftPro orders will accept wins, then
 * the oldest — an eleven-character code fails every order it is put on.
 */
export async function findSamePersonInCodeFamily(
  base: string,
  email: string | null | undefined,
): Promise<ExistingPerson | null> {
  const address = email?.trim().toLowerCase();
  if (!base || !address) return null;

  const rows = await db.select({
    id: contacts.id,
    lookup: contacts.lookupCode,
    softpro: contacts.softproLookupCode,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    fullName: contacts.fullName,
    email: contacts.email,
    phone: contacts.phone,
    address1: contacts.address1,
    city: contacts.city,
    flookupCode: contacts.flookupCode,
    companyName: contacts.companyName,
  }).from(contacts).where(sql`
    ${contacts.isActive} = true
    AND ${contacts.type} = 'person'
    AND lower(${contacts.email}) = ${address}
  `);

  const candidates = rows
    .map((r) => ({ ...r, code: r.softpro ?? r.lookup ?? '' }))
    .filter((r) => r.code && isInLookupCodeFamily(r.code, base))
    .sort((a, b) => {
      const aTooLong = a.code.length > MAX_LOOKUP_CODE_LENGTH ? 1 : 0;
      const bTooLong = b.code.length > MAX_LOOKUP_CODE_LENGTH ? 1 : 0;
      return aTooLong - bTooLong || a.id - b.id;
    });

  const hit = candidates[0];
  if (!hit) return null;
  return {
    id: hit.id,
    lookupCode: hit.code,
    firstName: hit.firstName,
    lastName: hit.lastName,
    fullName: hit.fullName,
    email: hit.email,
    phone: hit.phone,
    address1: hit.address1,
    city: hit.city,
    flookupCode: hit.flookupCode,
    companyName: hit.companyName,
  };
}

/** SoftPro treats company and person codes as one namespace. */
export async function allocateLookupCode(
  base: string,
  extraTaken: Iterable<string> = [],
): Promise<string> {
  if (!base) return base;
  const pattern = likePrefix(base);
  const [companyRows, contactRows] = await Promise.all([
    db.select({ code: companies.lookupCode }).from(companies)
      .where(sql`${companies.lookupCode} ILIKE ${pattern} ESCAPE '\\'`),
    db.select({
      lookup: contacts.lookupCode,
      softpro: contacts.softproLookupCode,
    }).from(contacts).where(or(
      sql`${contacts.lookupCode} ILIKE ${pattern} ESCAPE '\\'`,
      sql`${contacts.softproLookupCode} ILIKE ${pattern} ESCAPE '\\'`,
    )),
  ]);

  const existing = new Set<string>();
  for (const row of companyRows) {
    if (row.code) existing.add(row.code);
  }
  for (const row of contactRows) {
    if (row.lookup) existing.add(row.lookup);
    if (row.softpro) existing.add(row.softpro);
  }
  for (const code of extraTaken) {
    if (code.trim()) existing.add(code.trim());
  }
  return uniquifyLookupCode(base, existing);
}

export type LookupPushResult =
  | { ok: true; lookupCode: string }
  | {
      ok: false;
      error: string;
      codesTried: string[];
      collision: boolean;
      /** Set when the refuse policy stopped on a code SoftPro holds and we do not. */
      existsInSoftPro?: string;
    };

/**
 * What to do when SoftPro says a code already exists that our table does not
 * hold.
 *
 * `suffix` mints the next code and tries again. Companies still do this.
 *
 * `refuse` stops. For a PERSON the base code is three letters of the first
 * name, three of the last, and four of the company, so a clash at the same
 * company is almost certainly the same person — Erika Valencia on 2026-09-10,
 * whom SoftPro had held all along and who was created twice more. A SoftPro
 * record is permanent and cannot be deleted; a refusal costs the operator a
 * moment. Decided by Gerard 2026-09-11.
 */
export type VendorCollisionPolicy = 'suffix' | 'refuse';

/**
 * Send to SoftPro; if the vendor already has that code (and we do not), bump
 * the suffix and retry in this request. A human clicking Create again must
 * not resubmit the same rejected code in a loop.
 */
export async function sendWithUniqueLookupCode(
  base: string,
  send: (lookupCode: string) => Promise<{ success: boolean; error?: { message?: string } }>,
  options: { onVendorCollision?: VendorCollisionPolicy } = {},
): Promise<LookupPushResult> {
  const policy = options.onVendorCollision ?? 'suffix';
  const rejected: string[] = [];
  for (let attempt = 0; attempt < LOOKUP_PUSH_MAX_ATTEMPTS; attempt++) {
    const lookupCode = await allocateLookupCode(base, rejected);
    const result = await send(lookupCode);
    if (result.success) return { ok: true, lookupCode };
    rejected.push(lookupCode);
    const message = result.error?.message ?? 'SoftPro rejected the lookup code';
    if (!isSoftProLookupCollision(message)) {
      return { ok: false, error: message, codesTried: rejected, collision: false };
    }
    if (policy === 'refuse') {
      // allocateLookupCode already skips every code our table holds, so a
      // SoftPro duplicate here is someone SoftPro has and the hub does not.
      return {
        ok: false,
        error: `SoftPro already has a contact with the lookup code ${lookupCode} that is not in the hub yet. `
          + 'This is very likely the same person, so nothing was created — a second SoftPro record '
          + 'cannot be deleted. Report the code so the existing record can be brought across.',
        codesTried: rejected,
        collision: true,
        existsInSoftPro: lookupCode,
      };
    }
  }
  return {
    ok: false,
    error: `SoftPro already has lookup codes ${rejected.join(', ')}. Not creating a local row.`,
    codesTried: rejected,
    collision: true,
  };
}
