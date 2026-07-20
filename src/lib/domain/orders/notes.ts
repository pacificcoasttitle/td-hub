import { db } from '@/lib/db/client';
import { orderNotes, orders } from '@/lib/db/schema';
import { addNotes } from '@/lib/integrations/softpro';
import { and, desc, eq } from 'drizzle-orm';
import type { OrderSubresourceVisibility } from './subresource-visibility';

export interface OrderNote {
  id: number;
  subject: string | null;
  body: string;
  authorName: string | null;
  createdAt: Date | string;
  isSyncedToSoftpro: boolean | null;
  /** Staff-only; omitted for client visibility. */
  isInternal?: boolean;
}

export interface GetOrderNotesResult {
  notes: OrderNote[];
}

export type CreateOrderNoteResult =
  | { ok: true; note: OrderNote; synced: boolean }
  | { ok: false; notFound: true };

/**
 * Canonical notes loader.
 * Client policy enforces `is_internal = false` inside this function (not in routes).
 */
export async function getOrderNotes(
  orderId: number,
  visibility: OrderSubresourceVisibility,
): Promise<GetOrderNotesResult> {
  if (visibility === 'client') {
    const rows = await db
      .select({
        id: orderNotes.id,
        subject: orderNotes.subject,
        body: orderNotes.body,
        authorName: orderNotes.authorName,
        createdAt: orderNotes.createdAt,
        isSyncedToSoftpro: orderNotes.isSyncedToSoftpro,
      })
      .from(orderNotes)
      .where(and(eq(orderNotes.orderId, orderId), eq(orderNotes.isInternal, false)))
      .orderBy(desc(orderNotes.createdAt));

    return { notes: rows };
  }

  const rows = await db
    .select({
      id: orderNotes.id,
      subject: orderNotes.subject,
      body: orderNotes.body,
      authorName: orderNotes.authorName,
      createdAt: orderNotes.createdAt,
      isSyncedToSoftpro: orderNotes.isSyncedToSoftpro,
      isInternal: orderNotes.isInternal,
    })
    .from(orderNotes)
    .where(eq(orderNotes.orderId, orderId))
    .orderBy(desc(orderNotes.createdAt));

  return { notes: rows };
}

export async function createOrderNote(input: {
  orderId: number;
  visibility: OrderSubresourceVisibility;
  text: string;
  subject?: string | null;
  /** Staff only: when true, note is client-visible (`is_internal = false`). */
  shareWithClient?: boolean;
  authorName: string;
  authorId: string;
}): Promise<CreateOrderNoteResult> {
  const [order] = await db
    .select({ fileNumber: orders.fileNumber })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);

  if (!order) {
    return { ok: false, notFound: true };
  }

  const isInternal = input.visibility === 'client'
    ? false
    : input.shareWithClient !== true;

  const [note] = await db.insert(orderNotes).values({
    orderId: input.orderId,
    subject: input.subject ?? null,
    body: input.text,
    authorName: input.authorName,
    authorId: input.authorId,
    isInternal,
  }).returning();

  let synced = false;
  try {
    const spResult = await addNotes(order.fileNumber, input.text);
    if (spResult.success) {
      synced = true;
      await db.update(orderNotes).set({ isSyncedToSoftpro: true }).where(eq(orderNotes.id, note!.id));
    }
  } catch { /* best effort */ }

  if (input.visibility === 'client') {
    return {
      ok: true,
      synced,
      note: {
        id: note!.id,
        subject: note!.subject,
        body: note!.body,
        authorName: note!.authorName,
        createdAt: note!.createdAt,
        isSyncedToSoftpro: synced,
      },
    };
  }

  return {
    ok: true,
    synced,
    note: {
      id: note!.id,
      subject: note!.subject,
      body: note!.body,
      authorName: note!.authorName,
      createdAt: note!.createdAt,
      isSyncedToSoftpro: synced,
      isInternal: note!.isInternal,
    },
  };
}
