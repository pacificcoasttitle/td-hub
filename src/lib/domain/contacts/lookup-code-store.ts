import { or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies, contacts } from '@/lib/db/schema';
import { isSoftProLookupCollision, uniquifyLookupCode } from './lookup-code';

export const LOOKUP_PUSH_MAX_ATTEMPTS = 5;

function likePrefix(base: string): string {
  return `${base.replace(/[%_\\]/g, '\\$&')}%`;
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
  | { ok: false; error: string; codesTried: string[]; collision: boolean };

/**
 * Send to SoftPro; if the vendor already has that code (and we do not), bump
 * the suffix and retry in this request. A human clicking Create again must
 * not resubmit the same rejected code in a loop.
 */
export async function sendWithUniqueLookupCode(
  base: string,
  send: (lookupCode: string) => Promise<{ success: boolean; error?: { message?: string } }>,
): Promise<LookupPushResult> {
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
  }
  return {
    ok: false,
    error: `SoftPro already has lookup codes ${rejected.join(', ')}. Not creating a local row.`,
    codesTried: rejected,
    collision: true,
  };
}
