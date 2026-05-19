import { db } from '@/lib/db/client';
import { orders, contacts, companies } from '@/lib/db/schema';
import { eq, and, isNull, or, sql } from 'drizzle-orm';
import { getOrderContacts } from '@/lib/integrations/softpro';
import type { SoftProOrderContactsData } from '@/lib/integrations/softpro';
import { resolveClientContactId } from '@/lib/domain/orders/client-resolver';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnrichOrdersResult {
  total: number;
  enriched: number;
  skipped: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

export interface EnrichSingleResult {
  success: boolean;
  orderId: number;
  fileNumber: string;
  resolved: Record<string, number | null>;
  unresolved: string[];
  error?: string;
}

// ─── Single Order Enrichment ─────────────────────────────────────────────────

export async function enrichSingleOrder(orderId: number): Promise<EnrichSingleResult> {
  const [order] = await db.select({ id: orders.id, fileNumber: orders.fileNumber, orderType: orders.orderType })
    .from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order) {
    return { success: false, orderId, fileNumber: '', resolved: {}, unresolved: [], error: 'Order not found' };
  }

  return enrichOrder(order);
}

async function enrichOrder(order: { id: number; fileNumber: string; orderType: string | null }): Promise<EnrichSingleResult> {
  const result: EnrichSingleResult = {
    success: false,
    orderId: order.id,
    fileNumber: order.fileNumber,
    resolved: {},
    unresolved: [],
  };

  const apiResult = await getOrderContacts(order.fileNumber);
  if (!apiResult.success || !apiResult.data) {
    result.error = apiResult.error?.message ?? 'GetOrderContacts returned no data';
    return result;
  }

  const data = apiResult.data;
  const updates: Record<string, number | null> = {};

  const lenderCode = safeGet(data, 'Lenders', 'PersonLookupCode');
  if (lenderCode) {
    const id = await resolveContact(lenderCode);
    updates.lenderId = id;
    if (id) result.resolved.lenderId = id;
    else result.unresolved.push(`Lenders.PersonLookupCode=${lenderCode}`);
  }

  const listingCode = safeGet(data, 'ListingAgentBrokers', 'PersonLookupCode');
  if (listingCode) {
    const id = await resolveContact(listingCode);
    updates.listingAgentId = id;
    if (id) {
      result.resolved.listingAgentId = id;
      await flagRealEstateAgentAndCompany(id);
    } else result.unresolved.push(`ListingAgentBrokers.PersonLookupCode=${listingCode}`);
  }

  const titleCompanyCode = safeGet(data, 'TitleCompanies', 'CompanyLookUpCode');
  if (titleCompanyCode) {
    const id = await resolveCompany(titleCompanyCode);
    updates.titleCompanyId = id;
    if (id) result.resolved.titleCompanyId = id;
    else result.unresolved.push(`TitleCompanies.CompanyLookUpCode=${titleCompanyCode}`);
  }

  const underwriterCode = safeGet(data, 'Underwriters', 'CompanyLookUpCode');
  if (underwriterCode) {
    const id = await resolveCompany(underwriterCode);
    updates.underwriterId = id;
    if (id) result.resolved.underwriterId = id;
    else result.unresolved.push(`Underwriters.CompanyLookUpCode=${underwriterCode}`);
  }

  const clientContactId = await resolveClientContactId(order.orderType, data);
  if (clientContactId) {
    updates.clientContactId = clientContactId;
    result.resolved.clientContactId = clientContactId;
  }

  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  let hasUpdate = false;
  for (const [key, val] of Object.entries(updates)) {
    if (val !== null) {
      setFields[key] = val;
      hasUpdate = true;
    }
  }

  if (hasUpdate) {
    await db.update(orders).set(setFields).where(eq(orders.id, order.id));
  }

  result.success = true;
  return result;
}

// ─── Batch Enrichment ────────────────────────────────────────────────────────

export async function handleEnrichOrders(): Promise<EnrichOrdersResult> {
  const unenriched = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber, orderType: orders.orderType })
    .from(orders)
    .where(
      and(
        or(
          and(
            isNull(orders.lenderId),
            isNull(orders.listingAgentId),
            isNull(orders.titleCompanyId),
            isNull(orders.underwriterId),
          ),
          isNull(orders.clientContactId),
        ),
        or(
          isNull(orders.lastContactsFetchAt),
          sql`${orders.lastContactsFetchAt} < NOW() - INTERVAL '6 hours'`,
        ),
      )
    )
    .orderBy(sql`${orders.lastContactsFetchAt} ASC NULLS FIRST`)
    .limit(200);

  let enriched = 0;
  let skipped = 0;
  const errors: EnrichOrdersResult['errors'] = [];

  for (const order of unenriched) {
    try {
      await db.update(orders)
        .set({ lastContactsFetchAt: sql`NOW()` })
        .where(eq(orders.id, order.id));

      const result = await enrichOrder(order);
      if (result.success && Object.keys(result.resolved).length > 0) {
        enriched++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors.push({
        fileNumber: order.fileNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { total: unenriched.length, enriched, skipped, errors };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeGet(data: SoftProOrderContactsData, section: keyof SoftProOrderContactsData, field: string): string | null {
  const obj = data[section] as Record<string, string> | undefined;
  if (!obj) return null;
  const val = obj[field];
  return val && val.trim() ? val.trim() : null;
}

async function resolveContact(lookupCode: string): Promise<number | null> {
  const [row] = await db.select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.lookupCode, lookupCode))
    .limit(1);
  return row?.id ?? null;
}

async function flagRealEstateAgentAndCompany(contactId: number): Promise<void> {
  await db.update(contacts)
    .set({ isRealEstateAgent: true, updatedAt: new Date() })
    .where(and(
      eq(contacts.id, contactId),
      eq(contacts.isRealEstateAgent, false),
    ));

  const [agent] = await db.select({ flookupCode: contacts.flookupCode })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!agent?.flookupCode) return;

  await db.update(companies)
    .set({ isRealEstateCompany: true, updatedAt: new Date() })
    .where(and(
      eq(companies.lookupCode, agent.flookupCode),
      eq(companies.isRealEstateCompany, false),
    ));
}

async function resolveCompany(lookupCode: string): Promise<number | null> {
  const [row] = await db.select({ id: companies.id })
    .from(companies)
    .where(eq(companies.lookupCode, lookupCode))
    .limit(1);
  return row?.id ?? null;
}
