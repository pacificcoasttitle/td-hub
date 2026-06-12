import { db } from '@/lib/db/client';
import { orders, orderParties, contacts } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { getOrderContacts, mapOrderContacts } from '@/lib/integrations/softpro';
import type { MappedOrderContacts } from '@/lib/integrations/softpro';

type ExistingParty = typeof orderParties.$inferSelect;

export interface VerifyOrderSyncResult {
  total: number;
  verified: number;
  updated: number;
  skipped: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

const BATCH_SIZE = 20;

export async function handleVerifyOrderSync(): Promise<VerifyOrderSyncResult> {
  const allOrders = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber, titleOfficerId: orders.titleOfficerId, escrowOfficerId: orders.escrowOfficerId, salesRepId: orders.salesRepId })
    .from(orders)
    .where(eq(orders.operationalStatus, 'open'))
    .limit(200);

  let verified = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ fileNumber: string; error: string }> = [];

  for (let i = 0; i < allOrders.length; i += BATCH_SIZE) {
    const batch = allOrders.slice(i, i + BATCH_SIZE);

    for (const order of batch) {
      try {
        const result = await getOrderContacts(order.fileNumber);
        if (!result.success || !result.data) {
          skipped++;
          continue;
        }

        const mapped = mapOrderContacts(result.data);
        const changes = await reconcileParties(order.id, mapped);
        const officerChanges = await reconcileOfficers(order, mapped);

        if (changes > 0 || officerChanges > 0) {
          updated++;
        } else {
          verified++;
        }
      } catch (err) {
        errors.push({
          fileNumber: order.fileNumber,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }

  return { total: allOrders.length, verified, updated, skipped, errors };
}

export async function verifySingleOrder(
  orderId: number,
  fileNumber: string,
): Promise<{ changes: Array<{ field: string; oldValue: string | null; newValue: string | null }>; updated: boolean }> {
  const result = await getOrderContacts(fileNumber);
  if (!result.success || !result.data) {
    return { changes: [], updated: false };
  }

  const mapped = mapOrderContacts(result.data);
  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];

  const existingParties = await db
    .select()
    .from(orderParties)
    .where(eq(orderParties.orderId, orderId));

  const partyChecks: Array<{ role: string; value: string | null; nameField: 'externalName' | 'externalCompany' }> = [
    { role: 'buyer', value: mapped.parties.buyer?.name ?? mapped.primaryBuyer, nameField: 'externalName' },
    { role: 'seller', value: mapped.parties.seller?.name ?? mapped.primarySeller, nameField: 'externalName' },
    { role: 'lender', value: mapped.parties.lender?.companyName ?? mapped.lenderCompanyCode, nameField: 'externalCompany' },
    { role: 'escrow_company', value: mapped.parties.escrowCompany?.companyName ?? mapped.escrowCompanyCode, nameField: 'externalCompany' },
  ];

  for (const check of partyChecks) {
    const local = existingParties.find((p: ExistingParty) => p.role === check.role && p.isPrimary !== false);
    const spValue = check.value;
    const localValue = local?.[check.nameField] ?? null;

    if (spValue && spValue !== localValue) {
      changes.push({ field: `${check.role}.${check.nameField}`, oldValue: localValue, newValue: spValue });
    }
  }

  if (changes.length > 0) {
    await reconcileParties(orderId, mapped);

    const [orderRow] = await db
      .select({ titleOfficerId: orders.titleOfficerId, escrowOfficerId: orders.escrowOfficerId, salesRepId: orders.salesRepId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (orderRow) {
      await reconcileOfficers({ id: orderId, ...orderRow }, mapped);
    }
  }

  return { changes, updated: changes.length > 0 };
}

async function reconcileParties(orderId: number, mapped: MappedOrderContacts): Promise<number> {
  const existing = await db
    .select()
    .from(orderParties)
    .where(eq(orderParties.orderId, orderId));

  let changeCount = 0;

  const updates: Array<{ role: string; isPrimary: boolean; name: string | null; company: string | null }> = [
    { role: 'buyer', isPrimary: true, name: mapped.parties.buyer?.name ?? mapped.primaryBuyer, company: mapped.parties.buyer?.companyName ?? null },
    { role: 'buyer', isPrimary: false, name: mapped.parties.secondaryBuyer?.name ?? mapped.secondaryBuyer, company: mapped.parties.secondaryBuyer?.companyName ?? null },
    { role: 'seller', isPrimary: true, name: mapped.parties.seller?.name ?? mapped.primarySeller, company: null },
    { role: 'seller', isPrimary: false, name: mapped.parties.secondarySeller?.name ?? mapped.secondarySeller, company: null },
    { role: 'lender', isPrimary: true, name: mapped.parties.lender?.name ?? null, company: mapped.parties.lender?.companyName ?? mapped.lenderCompanyCode },
    { role: 'escrow_company', isPrimary: true, name: mapped.parties.escrowCompany?.name ?? null, company: mapped.parties.escrowCompany?.companyName ?? mapped.escrowCompanyCode },
  ];

  for (const u of updates) {
    if (!u.name && !u.company) continue;

    const match = existing.find((p: ExistingParty) => p.role === u.role && p.isPrimary === u.isPrimary);
    if (match) {
      const nameChanged = u.name && match.externalName !== u.name;
      const companyChanged = u.company && match.externalCompany !== u.company;
      if (nameChanged || companyChanged) {
        await db.update(orderParties).set({
          ...(nameChanged ? { externalName: u.name } : {}),
          ...(companyChanged ? { externalCompany: u.company } : {}),
        }).where(eq(orderParties.id, match.id));
        changeCount++;
      }
    } else {
      await db.insert(orderParties).values({
        orderId,
        role: u.role as typeof orderParties.role.enumValues[number],
        isPrimary: u.isPrimary,
        externalName: u.name,
        externalCompany: u.company,
      });
      changeCount++;
    }
  }

  return changeCount;
}

async function reconcileOfficers(
  order: { id: number; titleOfficerId: number | null; escrowOfficerId: number | null; salesRepId: number | null },
  mapped: MappedOrderContacts,
): Promise<number> {
  let changeCount = 0;
  const updates: Partial<typeof orders.$inferInsert> = {};

  const titleOfficerLookupCode = mapped.parties.titleCompany?.lookupCode ?? mapped.titleOfficerName;
  if (titleOfficerLookupCode && !order.titleOfficerId) {
    const contact = await findContactByLookupCode(titleOfficerLookupCode);
    if (contact) {
      updates.titleOfficerId = contact.id;
      changeCount++;
    }
  }

  if (mapped.escrowPersonCode && !order.escrowOfficerId) {
    const contact = await findContactByLookupCode(mapped.escrowPersonCode);
    if (contact) {
      updates.escrowOfficerId = contact.id;
      changeCount++;
    }
  }

  if (changeCount > 0) {
    await db.update(orders).set({ ...updates, updatedAt: new Date() }).where(eq(orders.id, order.id));
  }

  return changeCount;
}

async function findContactByLookupCode(code: string) {
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`${contacts.softproLookupCode} = ${code} OR ${contacts.fullName} = ${code}`)
    .limit(1);
  return contact ?? null;
}
