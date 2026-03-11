import { db } from '@/lib/db/client';
import { orders, orderParties } from '@/lib/db/schema';
import { getOrderContacts, mapOrderContacts } from '@/lib/integrations/softpro';
import type { MappedOrderContacts } from '@/lib/integrations/softpro';
import { sql } from 'drizzle-orm';

export interface EnrichOrdersResult {
  total: number;
  enriched: number;
  skipped: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

/**
 * Finds orders with no order_parties records and enriches them from
 * SoftPro's GetOrderContacts endpoint. Runs as a scheduled job to
 * backfill contacts that weren't available during initial sync.
 */
export async function handleEnrichOrders(): Promise<EnrichOrdersResult> {
  const unenriched = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber })
    .from(orders)
    .where(
      sql`NOT EXISTS (SELECT 1 FROM order_parties WHERE order_parties.order_id = ${orders.id})`
    )
    .limit(100);

  let enriched = 0;
  let skipped = 0;
  const errors: Array<{ fileNumber: string; error: string }> = [];

  for (const order of unenriched) {
    try {
      const result = await getOrderContacts(order.fileNumber);
      if (!result.success || !result.data) {
        skipped++;
        continue;
      }

      const contacts = mapOrderContacts(result.data);
      const parties = buildParties(order.id, contacts);

      if (parties.length === 0) {
        skipped++;
        continue;
      }

      await db.insert(orderParties).values(parties);
      enriched++;
    } catch (err) {
      errors.push({
        fileNumber: order.fileNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { total: unenriched.length, enriched, skipped, errors };
}

// ─── Party Builder ──────────────────────────────────────────────────────────

type PartyInsert = typeof orderParties.$inferInsert;

function buildParties(orderId: number, c: MappedOrderContacts): PartyInsert[] {
  const parties: PartyInsert[] = [];

  if (c.primaryBuyer) {
    parties.push({ orderId, role: 'buyer', isPrimary: true, externalName: c.primaryBuyer });
  }
  if (c.secondaryBuyer) {
    parties.push({ orderId, role: 'buyer', isPrimary: false, externalName: c.secondaryBuyer });
  }
  if (c.primarySeller) {
    parties.push({ orderId, role: 'seller', isPrimary: true, externalName: c.primarySeller });
  }
  if (c.secondarySeller) {
    parties.push({ orderId, role: 'seller', isPrimary: false, externalName: c.secondarySeller });
  }
  if (c.escrowCompanyCode) {
    parties.push({ orderId, role: 'escrow_company', externalName: c.escrowPersonCode, externalCompany: c.escrowCompanyCode });
  }
  if (c.lenderCode || c.lenderCompanyCode) {
    parties.push({ orderId, role: 'lender', externalName: c.lenderCode, externalCompany: c.lenderCompanyCode });
  }
  if (c.listingAgentPersonCode || c.listingAgentCompanyCode) {
    parties.push({ orderId, role: 'listing_agent', externalName: c.listingAgentPersonCode, externalCompany: c.listingAgentCompanyCode });
  }
  if (c.mortgageBrokerCode) {
    parties.push({ orderId, role: 'other', externalName: c.mortgageBrokerCode });
  }
  if (c.payoffLenderCode) {
    parties.push({ orderId, role: 'lender_contact', externalName: c.payoffLenderCode });
  }
  if (c.titleCompanyCode) {
    parties.push({ orderId, role: 'other', externalName: c.titleOfficerName, externalCompany: c.titleCompanyCode });
  }
  if (c.underwriterCompanyCode || c.underwriterPersonCode) {
    parties.push({ orderId, role: 'other', externalName: c.underwriterPersonCode, externalCompany: c.underwriterCompanyCode });
  }

  return parties;
}
