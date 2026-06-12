import { eq, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import type { SoftProOrderContactsData } from '@/lib/integrations/softpro';

/**
 * Resolve the "client" (submitter/opener) for an order based on SoftPro
 * GetOrderContacts data.
 *
 * Logic by order type:
 * - Title only: escrow officer at external escrow company
 *   (EscrowCompanies.Person.LookupCode)
 * - Title & Escrow: lender contact (Lenders.PersonLookupCode), fallback agent
 * - Escrow only: lender contact, fallback agent
 * - Trustee Sale Guarantee: listing agent
 *
 * The first available contact in priority order wins. Returns null if no
 * resolution is possible.
 */
export async function resolveClientContactId(
  orderType: string | null,
  contactsResponse: SoftProOrderContactsData,
): Promise<number | null> {
  async function lookupBySoftproCode(code: string | null | undefined): Promise<number | null> {
    const trimmed = code?.trim();
    if (!trimmed) return null;

    const [found] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(or(eq(contacts.softproLookupCode, trimmed), eq(contacts.lookupCode, trimmed)))
      .limit(1);

    return found?.id ?? null;
  }

  const escrowPersonCode = contactsResponse.EscrowCompanies?.Person?.LookupCode
    ?? contactsResponse.EscrowCompanies?.PersonLookupCode;
  const lenderPersonCode = contactsResponse.Lenders?.Person?.LookupCode
    ?? contactsResponse.Lenders?.PersonLookupCode;
  const agentPersonCode = contactsResponse.ListingAgentBrokers?.Person?.LookupCode
    ?? contactsResponse.ListingAgentBrokers?.PersonLookupCode;

  if (orderType === 'Title only') {
    return (await lookupBySoftproCode(escrowPersonCode))
      ?? (await lookupBySoftproCode(lenderPersonCode))
      ?? (await lookupBySoftproCode(agentPersonCode));
  }

  if (orderType === 'Trustee Sale Guarantee') {
    return (await lookupBySoftproCode(agentPersonCode))
      ?? (await lookupBySoftproCode(escrowPersonCode))
      ?? (await lookupBySoftproCode(lenderPersonCode));
  }

  if (orderType === 'Title & Escrow' || orderType === 'Escrow only') {
    return (await lookupBySoftproCode(lenderPersonCode))
      ?? (await lookupBySoftproCode(agentPersonCode));
  }

  return (await lookupBySoftproCode(escrowPersonCode))
    ?? (await lookupBySoftproCode(lenderPersonCode))
    ?? (await lookupBySoftproCode(agentPersonCode));
}
