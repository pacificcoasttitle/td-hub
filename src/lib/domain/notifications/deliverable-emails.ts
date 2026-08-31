import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { orderDeliverableEmails } from '@/lib/db/schema';

// ─── Deliverable emails: the per-order CC list ──────────────────────────────
//
// The operator types addresses on the open-order form; those people are copied
// on the order confirmation.
//
// ═══ THE RULE THIS MODULE EXISTS TO ENFORCE ════════════════════════════════
//
// THE SEND PATH READS THE STORED LIST. It never accepts an address from a
// request payload at send time.
//
// That is enforced by shape, not by convention: `deliverableEmailsForSend`
// takes an ORDER ID and nothing else. There is no parameter through which a
// caller could introduce a recipient, so a stale browser bundle posting
// `deliverableEmails` at send time has nowhere to put it.
//
// This is the legacy delivery defect made unrepresentable — there, the browser
// supplied both the recipient and the attachment URL and the server obliged.
//
// ═══ REMOVAL TAKES EFFECT IMMEDIATELY ══════════════════════════════════════
//
// Every read filters `removed_at IS NULL` at send time rather than resolving a
// list once and holding it. Someone removing an address is trying to stop that
// person receiving something — they left the firm, or were added by mistake.
// Finishing what is already in flight would deliver the exact thing they are
// preventing.

// ─── INVARIANTS THIS MODULE UPHOLDS ─────────────────────────────────────────
//
// I1. THESE ADDRESSES NEVER DISPLACE openorders@pct.com.
//     They are appended to CC candidates and nothing here removes an existing
//     recipient. See confirmation-recipients.ts, where the guarantee lives.
//
// I2. AN OPERATOR-TYPED ADDRESS IS NEVER PROMOTABLE TO TO.
//     This module returns a plain string[] for CC and offers no path to TO.
//     A future caller wanting to make one primary would have to change the
//     resolver, not this file — which is the point.
//
// I3. THE SEND PATH READS THE STORED LIST, BY ORDER ID.
//     `deliverableEmailsForSend` takes an order id and nothing else, so no
//     request payload can introduce a recipient.

export {
  MAX_DELIVERABLE_EMAILS,
  normalizeEmail,
  isValidDeliverableEmail,
  validateDeliverableEmails,
} from './deliverable-emails-validation';
import { validateDeliverableEmails, MAX_DELIVERABLE_EMAILS } from './deliverable-emails-validation';

export interface DeliverableEmail {
  id: number;
  email: string;
  addedBy: string | null;
  addedAt: Date;
}

/** Live addresses for an order, oldest first. Includes provenance for the UI. */
export async function listDeliverableEmails(orderId: number): Promise<DeliverableEmail[]> {
  const rows = await db
    .select({
      id: orderDeliverableEmails.id,
      email: orderDeliverableEmails.email,
      addedBy: orderDeliverableEmails.addedBy,
      addedAt: orderDeliverableEmails.addedAt,
    })
    .from(orderDeliverableEmails)
    .where(and(
      eq(orderDeliverableEmails.orderId, orderId),
      isNull(orderDeliverableEmails.removedAt),
    ))
    .orderBy(asc(orderDeliverableEmails.id));

  return rows;
}

/**
 * THE ONLY FUNCTION THE SEND PATH CALLS.
 *
 * Takes an order id. Returns addresses. No parameter accepts a recipient, by
 * design — see the module note.
 */
export async function deliverableEmailsForSend(orderId: number): Promise<string[]> {
  const rows = await listDeliverableEmails(orderId);
  return rows.map((r) => r.email);
}

/** Add addresses to an order. Already-present live addresses are left alone. */
export async function addDeliverableEmails(
  orderId: number,
  emails: string[],
  addedBy: string | null,
): Promise<{ added: string[]; invalid: string[]; atLimit: boolean }> {
  const { valid, invalid } = validateDeliverableEmails(emails);
  if (valid.length === 0) return { added: [], invalid, atLimit: false };

  const existing = new Set((await listDeliverableEmails(orderId)).map((r) => r.email));
  const room = MAX_DELIVERABLE_EMAILS - existing.size;
  const fresh = valid.filter((e) => !existing.has(e));
  const toAdd = fresh.slice(0, Math.max(0, room));

  if (toAdd.length > 0) {
    await db.insert(orderDeliverableEmails).values(
      toAdd.map((email) => ({ orderId, email, addedBy })),
    );
  }

  return { added: toAdd, invalid, atLimit: fresh.length > toAdd.length };
}

/**
 * Soft-remove one address. The row stays, so the fact that it received
 * documents remains attributable.
 */
export async function removeDeliverableEmail(
  orderId: number,
  id: number,
  removedBy: string | null,
): Promise<boolean> {
  const res = await db
    .update(orderDeliverableEmails)
    .set({ removedAt: new Date(), removedBy })
    .where(and(
      eq(orderDeliverableEmails.id, id),
      eq(orderDeliverableEmails.orderId, orderId),
      isNull(orderDeliverableEmails.removedAt),
    ))
    .returning({ id: orderDeliverableEmails.id });

  return res.length > 0;
}
