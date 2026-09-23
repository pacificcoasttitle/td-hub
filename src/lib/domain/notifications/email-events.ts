import { inArray, eq, and, sql as raw } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { emailEvents, notificationLogs, reportDeliveries } from '@/lib/db/schema';

/**
 * ─── What SendGrid said, and what we show because of it ─────────────────────
 *
 * The webhook hands this a batch of events. Two jobs, in order:
 *
 *   1. Keep the ones that are OURS, verbatim, append-only.
 *   2. Recompute the outcome shown to a human from everything we now hold
 *      about that message.
 *
 * Recompute, not apply-in-place. Events arrive out of order and are retried,
 * and an incremental rule ("a bounce overwrites a delivered") gets the answer
 * wrong the moment two events land in the wrong sequence. Deriving the answer
 * from the full set each time is immune to arrival order by construction.
 */

/** SendGrid's own names, as they appear on the wire. */
export const OUTCOME_BY_EVENT: Record<string, 'delivered' | 'bounced' | 'dropped' | 'spam'> = {
  delivered: 'delivered',
  // One event name covers a hard bounce and a block; `type` in the payload
  // distinguishes them, and the reason text says which in words.
  bounce: 'bounced',
  dropped: 'dropped',
  spamreport: 'spam',
};

/**
 * Events that say nothing about whether it arrived. 'deferred' is the one that
 * matters here: it means SendGrid is still retrying. Treating it as an outcome
 * would put an alarming word against the ordinary case of a busy mail server.
 */
export const NOT_AN_OUTCOME = new Set(['processed', 'deferred', 'open', 'click', 'unsubscribe', 'group_unsubscribe', 'group_resubscribe']);

export interface SendGridEvent {
  sg_message_id?: string;
  email?: string;
  event?: string;
  timestamp?: number;
  reason?: string;
  status?: string;
  type?: string;
  [k: string]: unknown;
}

/**
 * THE ID SENDGRID SENDS IS NOT THE ID WE STORED.
 *
 * We keep the `X-Message-Id` header from the send — `abc123XYZ`. The event
 * carries `abc123XYZ.filterdrecv-abcdef-1234-ab-9876.0`, the same id with
 * routing detail appended. Matching them whole finds nothing, and the webhook
 * would sit there storing zero events and looking like it worked.
 */
export function baseMessageId(raw: string): string {
  return raw.split('.')[0]!.trim();
}

/** The reason, in SendGrid's words. Different event types put it in different fields. */
export function reasonOf(e: SendGridEvent): string | null {
  const parts = [e.type, e.reason ?? e.status].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return parts.length ? parts.join(': ') : null;
}

export interface IngestResult {
  received: number;
  /** Ours, and stored. */
  kept: number;
  /** Someone else's mail on the same account, or a message we have no record of. */
  unmatched: number;
  /** Already held — SendGrid retried a batch. */
  duplicates: number;
  /** Malformed beyond use: no message id, or no timestamp. */
  unusable: number;
  /** Rows whose outcome changed as a result, across both logs. */
  updated: number;
}

/**
 * ─── WHICH LOG A SEND LIVES IN ──────────────────────────────────────────────
 *
 * Two tables record outbound mail, for historical reasons, and the events have
 * to reach both:
 *
 *   notification_logs    confirmations and prelims — the CLIENT-FACING mail.
 *                        2,874 rows, every one carrying a message id.
 *   report_deliveries    Notify rep. Zero rows in production so far.
 *
 * Matching only report_deliveries would have been a webhook that caught NONE
 * of the seventeen silent drops, because every one of them was a prelim or a
 * confirmation. It would have looked like it worked.
 *
 * MATCHED ON MESSAGE **AND** RECIPIENT. One message id covers up to eight
 * recipients — a confirmation goes to the escrow officer, the agents and the
 * cc list under a single id. SendGrid reports per recipient. Matching on the
 * id alone would stamp one person's bounce across all eight rows and tell the
 * team seven lies for every truth.
 */
const key = (messageId: string, email: string) => `${messageId}|${email.trim().toLowerCase()}`;

export async function ingestEvents(batch: SendGridEvent[]): Promise<IngestResult> {
  const result: IngestResult = { received: batch.length, kept: 0, unmatched: 0, duplicates: 0, unusable: 0, updated: 0 };

  const usable = batch
    .map((e) => ({ e, id: typeof e.sg_message_id === 'string' ? baseMessageId(e.sg_message_id) : '' }))
    .filter(({ e, id }) => {
      const ok = id.length > 0 && typeof e.timestamp === 'number' && Number.isFinite(e.timestamp)
        && typeof e.event === 'string' && e.event.length > 0;
      if (!ok) result.unusable++;
      return ok;
    });
  if (usable.length === 0) return result;

  // ── Ours, or the other sender's? ─────────────────────────────────────────
  // The account carries far more of someone else's mail than of ours. A
  // message id we never recorded is not an error and not ours; it is counted
  // and dropped.
  const ids = [...new Set(usable.map(({ id }) => id))];
  const [deliveries, notifications] = await Promise.all([
    db.select({ messageId: reportDeliveries.providerMessageId, email: reportDeliveries.recipientEmail })
      .from(reportDeliveries).where(inArray(reportDeliveries.providerMessageId, ids)),
    db.select({ messageId: notificationLogs.providerId, email: notificationLogs.recipientEmail })
      .from(notificationLogs).where(inArray(notificationLogs.providerId, ids)),
  ]);

  const known = new Set<string>();
  for (const r of [...deliveries, ...notifications]) {
    if (r.messageId && r.email) known.add(key(r.messageId, r.email));
  }

  const ours = usable.filter(({ e, id }) => known.has(key(id, String(e.email ?? ''))));
  result.unmatched = usable.length - ours.length;
  if (ours.length === 0) return result;

  // ── Store them, verbatim ─────────────────────────────────────────────────
  // (message, event, instant) is the identity of one occurrence, so a retried
  // batch adds nothing rather than counting a bounce twice.
  const inserted = await db.insert(emailEvents).values(ours.map(({ e, id }) => ({
    sgMessageId: id,
    event: e.event!,
    email: String(e.email ?? ''),
    occurredAt: new Date(e.timestamp! * 1000),
    reason: reasonOf(e),
    raw: e as Record<string, unknown>,
  }))).onConflictDoNothing().returning({ id: emailEvents.id });

  result.kept = inserted.length;
  result.duplicates = ours.length - inserted.length;

  // ── Recompute what a human is shown, per recipient ───────────────────────
  const touched = new Map<string, { id: string; email: string }>();
  for (const { e, id } of ours) {
    const email = String(e.email ?? '');
    touched.set(key(id, email), { id, email });
  }

  for (const { id, email } of touched.values()) {
    const outcome = await outcomeFor(id, email);
    if (!outcome) continue;

    const [a, b] = await Promise.all([
      db.update(reportDeliveries)
        .set({ outcome: outcome.outcome, outcomeDetail: outcome.detail })
        .where(and(
          eq(reportDeliveries.providerMessageId, id),
          raw`lower(${reportDeliveries.recipientEmail}) = ${email.toLowerCase()}`,
        ))
        .returning({ id: reportDeliveries.id }),
      // The client-facing log. errorMessage carries SendGrid's words, because
      // whoever rings the client needs to know what the server actually said.
      db.update(notificationLogs)
        .set({ status: outcome.outcome, errorMessage: outcome.detail })
        .where(and(
          eq(notificationLogs.providerId, id),
          raw`lower(${notificationLogs.recipientEmail}) = ${email.toLowerCase()}`,
        ))
        .returning({ id: notificationLogs.id }),
    ]);
    result.updated += a.length + b.length;
  }

  return result;
}

/**
 * The state of one message TO ONE RECIPIENT, derived from every event we hold.
 *
 * The latest meaningful event wins. That is right in both directions: a
 * spam report days after a delivery is the newer truth, and a delivered that
 * arrives late cannot overtake a bounce because it did not happen later.
 */
export async function outcomeFor(messageId: string, email: string): Promise<{ outcome: string; detail: string } | null> {
  const events = await db.select().from(emailEvents).where(eq(emailEvents.sgMessageId, messageId));

  const wanted = email.trim().toLowerCase();
  const meaningful = events
    .filter((e) => e.email.trim().toLowerCase() === wanted)
    .filter((e) => !NOT_AN_OUTCOME.has(e.event) && OUTCOME_BY_EVENT[e.event])
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const last = meaningful[meaningful.length - 1];
  if (!last) return null;

  const outcome = OUTCOME_BY_EVENT[last.event]!;
  const when = last.occurredAt.toISOString();
  const because = last.reason ? ` — ${last.reason}` : '';

  // The wording says who said it and when, because the person reading this is
  // about to ring a client and needs to know what actually happened.
  const detail = outcome === 'delivered'
    ? `Delivered: the receiving server accepted it at ${when}.`
    : `SendGrid reported ${last.event} at ${when}${because}. The recipient did NOT receive this.`;

  return { outcome, detail };
}
