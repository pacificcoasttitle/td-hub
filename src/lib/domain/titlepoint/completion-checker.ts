import { db } from '@/lib/db/client';
import { titlePointData, eventOutbox } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSetting } from '@/lib/domain/settings/service';

const REQUIRED_SEARCH_TYPES = ['legal_vesting', 'tax', 'grant_deed'] as const;

export interface CompletionCheckResult {
  complete: boolean;
  missing?: string[];
}

export async function checkTitlePointCompletion(
  orderId: number
): Promise<CompletionCheckResult> {
  const records = await db
    .select({ searchType: titlePointData.searchType, status: titlePointData.status })
    .from(titlePointData)
    .where(eq(titlePointData.orderId, orderId));

  const completedTypes = new Set(
    records
      .filter((r) => r.status === 'completed')
      .map((r) => r.searchType)
  );

  const missing = REQUIRED_SEARCH_TYPES.filter((t) => !completedTypes.has(t));

  return missing.length === 0
    ? { complete: true }
    : { complete: false, missing };
}

export async function hasConfirmationBeenSent(orderId: number): Promise<boolean> {
  const [existing] = await db
    .select({ id: eventOutbox.id })
    .from(eventOutbox)
    .where(
      and(
        eq(eventOutbox.orderId, orderId),
        eq(eventOutbox.eventType, 'order.confirmation'),
      )
    )
    .limit(1);

  return !!existing;
}

export async function maybeEnqueueConfirmation(orderId: number): Promise<boolean> {
  const enabled = await getSetting('open_order_confirmation_enabled');
  if (enabled === 'false') return false;

  const { complete } = await checkTitlePointCompletion(orderId);
  if (!complete) return false;

  const alreadySent = await hasConfirmationBeenSent(orderId);
  if (alreadySent) return false;

  await db.insert(eventOutbox).values({
    eventType: 'order.confirmation',
    orderId,
    payload: {} as Record<string, unknown>,
  });

  return true;
}
