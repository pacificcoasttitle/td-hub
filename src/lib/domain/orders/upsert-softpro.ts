import { db } from '@/lib/db/client';
import { orders, orderProperties, orderStatusHistory, contacts, branches } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { MappedOrderData } from '@/lib/integrations/softpro';
import { getOrderByFileNumber } from './service';

const VALID_TRANSACTION_TYPES = ['Purchase', 'Refinance', 'Equity', 'Other'] as const;
type TransactionType = (typeof VALID_TRANSACTION_TYPES)[number];

function validTransactionType(value: string | null): TransactionType | null {
  if (!value) return null;
  if ((VALID_TRANSACTION_TYPES as readonly string[]).includes(value)) return value as TransactionType;
  return null;
}

let branchCache: { id: number; code: string }[] | null = null;

async function getBranches() {
  if (!branchCache) {
    branchCache = await db.select({ id: branches.id, code: branches.code }).from(branches);
  }
  return branchCache;
}

function deriveBranchId(fileNumber: string, branchList: { id: number; code: string }[]): number | null {
  for (const b of branchList) {
    if (fileNumber.endsWith('-' + b.code)) return b.id;
  }
  return null;
}

async function resolveContactByOfficerName(name: string | null): Promise<number | null> {
  if (!name) return null;
  const result = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.officerName, name))
    .limit(1);
  return result[0]?.id ?? null;
}

export async function upsertFromSoftPro(
  mapped: MappedOrderData
): Promise<{ created: boolean; orderId: number }> {
  const existing = await getOrderByFileNumber(mapped.fileNumber);

  if (!existing) {
    const salesRepId = await resolveContactByOfficerName(mapped.marketingRepName);
    const titleOfficerId = await resolveContactByOfficerName(mapped.titleOfficerName);
    const branchList = await getBranches();
    const branchId = deriveBranchId(mapped.fileNumber, branchList);

    const [newOrder] = await db
      .insert(orders)
      .values({
        fileNumber: mapped.fileNumber,
        branchId,
        operationalStatus: mapped.operationalStatus,
        softproStatus: mapped.softproStatus,
        transactionType: validTransactionType(mapped.transactionType),
        productType: mapped.productType,
        orderType: mapped.orderType,
        salesPrice: mapped.salesPrice,
        salesRepId,
        titleOfficerId,
        openedAt: mapped.openedAt ?? new Date(),
        completedAt: mapped.completedAt,
        closedAt: mapped.closedAt,
        source: 'softpro_sync',
        isImported: true,
        softproLastSyncedAt: new Date(),
      })
      .returning({ id: orders.id });

    await db.insert(orderProperties).values({
      orderId: newOrder!.id,
      address: mapped.property.address,
      city: mapped.property.city,
      state: mapped.property.state,
      county: mapped.property.county,
      fullAddress: mapped.property.fullAddress,
    });

    await db.insert(orderStatusHistory).values({
      orderId: newOrder!.id,
      status: mapped.operationalStatus,
      source: 'softpro_sync',
      notes: 'Initial sync from SoftPro',
    });

    return { created: true, orderId: newOrder!.id };
  }

  const statusChanged = existing.operationalStatus !== mapped.operationalStatus;

  let branchIdUpdate: number | null | undefined;
  if (!existing.branchId) {
    const branchList = await getBranches();
    branchIdUpdate = deriveBranchId(mapped.fileNumber, branchList);
  }

  await db
    .update(orders)
    .set({
      softproStatus: mapped.softproStatus,
      operationalStatus: mapped.operationalStatus,
      completedAt: mapped.completedAt ?? existing.completedAt,
      closedAt: mapped.closedAt ?? existing.closedAt,
      salesPrice: mapped.salesPrice ?? existing.salesPrice,
      softproLastSyncedAt: new Date(),
      updatedAt: new Date(),
      ...(branchIdUpdate != null ? { branchId: branchIdUpdate } : {}),
    })
    .where(eq(orders.id, existing.id));

  if (statusChanged) {
    await db.insert(orderStatusHistory).values({
      orderId: existing.id,
      status: mapped.operationalStatus,
      source: 'softpro_sync',
      notes: `Status changed from ${existing.operationalStatus} to ${mapped.operationalStatus}`,
    });
  }

  return { created: false, orderId: existing.id };
}
