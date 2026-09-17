/**
 * One-shot: the 2026-09-17 watched ten. Not a cron. Not the admin send path.
 *
 * Calls maybeAutoDeliverPrelim so the three-day age rule, content check, and
 * no-second-send marker all still run. The admin send is not used — that
 * bypasses the guard.
 *
 * Rate: one order at a time, 5s pause between calls. Each call may make
 * one SoftPro GetOrderContacts (pre-send refresh). Ceiling: 10 orders,
 * so at most 10 SoftPro GETs and 10 SendGrid sends. Not wired to
 * vercel.json. See retry-held-prelim-watched-ten.test.ts.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documentAudit, documents, orders } from '@/lib/db/schema';
import { maybeAutoDeliverPrelim } from '@/lib/domain/notifications/prelim-auto-delivery';

export const WATCHED_TEN_FILE_NUMBERS = [
  '20022152-GLT',
  '20022153-OCT',
  '20022154-GLT',
  '20022156-OCT',
  '20022157-GLT',
  '20022172-GLT',
  '20022176-GLT',
  '20022177-GLT',
  '20022180-GLT',
  '20022183-OCT',
] as const;

export const RETRY_HELD_PRELIM_CEILING = 10;
export const RETRY_HELD_PRELIM_PAUSE_MS = 5_000;

export interface RetryHeldPrelimRow {
  fileNumber: string;
  orderId?: number;
  documentId?: number;
  outcome: string;
  sent: boolean;
  messageId?: string;
  reason?: string;
  issuedAtSource?: string;
}

export interface RetryHeldPrelimResult {
  attempted: number;
  sent: number;
  rows: RetryHeldPrelimRow[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadActivePrelim(fileNumber: string): Promise<{
  orderId: number;
  documentId: number;
  documentCreatedAt: Date;
  softproDocumentAt: Date | null;
} | null> {
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.fileNumber, fileNumber))
    .limit(1);
  if (!order) return null;

  const [doc] = await db
    .select({
      id: documents.id,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(
      eq(documents.orderId, order.id),
      eq(documents.category, 'prelim'),
      eq(documents.status, 'active'),
    ))
    .orderBy(desc(documents.createdAt), desc(documents.id))
    .limit(1);
  if (!doc) return null;

  const [audit] = await db
    .select({ meta: documentAudit.meta })
    .from(documentAudit)
    .where(and(
      eq(documentAudit.documentId, doc.id),
      eq(documentAudit.action, 'uploaded'),
    ))
    .orderBy(desc(documentAudit.performedAt), desc(documentAudit.id))
    .limit(1);

  const raw = (audit?.meta as Record<string, unknown> | null)?.occurredAt;
  let softproDocumentAt: Date | null = null;
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) softproDocumentAt = parsed;
  }

  return {
    orderId: order.id,
    documentId: doc.id,
    documentCreatedAt: doc.createdAt,
    softproDocumentAt,
  };
}

export async function handleRetryHeldPrelimWatchedTen(): Promise<RetryHeldPrelimResult> {
  if (WATCHED_TEN_FILE_NUMBERS.length > RETRY_HELD_PRELIM_CEILING) {
    throw new Error(
      `watched list is ${WATCHED_TEN_FILE_NUMBERS.length}; ceiling is ${RETRY_HELD_PRELIM_CEILING}`,
    );
  }

  const rows: RetryHeldPrelimRow[] = [];

  for (let i = 0; i < WATCHED_TEN_FILE_NUMBERS.length; i++) {
    const fileNumber = WATCHED_TEN_FILE_NUMBERS[i]!;
    if (i > 0) await sleep(RETRY_HELD_PRELIM_PAUSE_MS);

    const loaded = await loadActivePrelim(fileNumber);
    if (!loaded) {
      rows.push({ fileNumber, outcome: 'not_found', sent: false, reason: 'order or active prelim missing' });
      continue;
    }

    const delivery = await maybeAutoDeliverPrelim({
      orderId: loaded.orderId,
      documentId: loaded.documentId,
      documentCreatedAt: loaded.documentCreatedAt,
      softproDocumentAt: loaded.softproDocumentAt,
      triggeredBy: 'fetch_prelims',
    });

    rows.push({
      fileNumber,
      orderId: loaded.orderId,
      documentId: loaded.documentId,
      outcome: delivery.outcome,
      sent: delivery.sent,
      messageId: delivery.messageId,
      reason: delivery.reason,
      issuedAtSource: delivery.issuedAtSource,
    });
  }

  return {
    attempted: rows.length,
    sent: rows.filter((r) => r.sent).length,
    rows,
  };
}
