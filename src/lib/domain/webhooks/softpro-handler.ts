import { z } from 'zod';
import { db } from '@/lib/db/client';
import { documents, documentAudit, orders, orderStatusHistory, eventOutbox, vendorApiLogs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { uploadFile as s3Upload } from '@/lib/integrations/s3/client';
import { analyzePrelim } from '@/lib/tessa';
import { getSetting } from '@/lib/domain/settings/service';
import { ingestPrelimFromSoftPro } from '@/lib/domain/documents/ingest-prelim-from-softpro';

const WEBHOOK_VENDOR = 'softpro_webhook';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

/**
 * Accepts:
 * - Legacy PHP post-prelim-report push:
 *   { Event, OrderNumber, DocumentUrl, StoredDocumentName, OrderId, OccurredAt, Source }
 * - Legacy array shape still used by tests/fixtures: { OrderNumber, data: string[] }
 */
export const prelimPayloadSchema = z.object({
  Event: z.string().optional(),
  OrderNumber: z.string().min(1),
  DocumentUrl: z.string().url().optional(),
  StoredDocumentName: z.string().optional(),
  OrderId: z.union([z.string(), z.number()]).optional(),
  OccurredAt: z.string().optional(),
  Source: z.string().optional(),
  Status: z.string().optional(),
  data: z.array(z.string().url()).optional(),
}).refine(
  (p) => !!p.DocumentUrl || (Array.isArray(p.data) && p.data.length > 0),
  { message: 'DocumentUrl or data[] with at least one URL is required' },
);

export const policyPayloadSchema = z.object({
  OrderNumber: z.string().min(1),
  data: z.array(z.object({
    FileName: z.string().min(1),
    FileUrl: z.string().url(),
  })),
});

export const milestonePayloadSchema = z.object({
  OrderNumber: z.string().min(1),
  Id: z.string().min(1),
  Status: z.string().min(1),
});

export type PrelimPayload = z.infer<typeof prelimPayloadSchema>;
export type PolicyPayload = z.infer<typeof policyPayloadSchema>;
export type MilestonePayload = z.infer<typeof milestonePayloadSchema>;

// ─── Result ─────────────────────────────────────────────────────────────────

export interface WebhookResult {
  success: boolean;
  processed: number;
  errors: string[];
  /** Observability summary for the prelim fast-path. */
  outcomes?: Array<{
    url: string;
    outcome: 'deduped' | 'stale' | 'ingested' | 'error';
    documentId?: number | null;
    delivered?: boolean;
    reason?: string;
  }>;
}

async function logPrelimWebhookOp(
  operation: string,
  orderId: number | null,
  meta: Record<string, unknown>,
  success: boolean,
) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: WEBHOOK_VENDOR,
      operation,
      orderId: orderId ?? undefined,
      requestId: crypto.randomUUID(),
      startedAt: new Date(),
      endedAt: new Date(),
      success,
      requestMeta: meta,
    });
  } catch { /* logging must not break the webhook */ }
}

function parseOccurredAt(raw: string | undefined): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizePrelimItems(payload: PrelimPayload): Array<{
  url: string;
  storedDocumentName: string | null;
  occurredAt: Date | null;
}> {
  if (payload.DocumentUrl) {
    return [{
      url: payload.DocumentUrl,
      storedDocumentName: payload.StoredDocumentName?.trim() || null,
      occurredAt: parseOccurredAt(payload.OccurredAt),
    }];
  }
  return (payload.data ?? []).map((url) => ({
    url,
    storedDocumentName: null,
    occurredAt: parseOccurredAt(payload.OccurredAt),
  }));
}

// ─── Task Code → Milestone Mapping ──────────────────────────────────────────

const MILESTONE_MAP: Record<string, { milestone: string; label: string }> = {
  '03-020':      { milestone: 'recording_confirmation', label: 'Recording confirmation' },
  'TSG-02-015':  { milestone: 'recording_confirmation', label: 'Recording confirmation' },
  'TSG-PRE-15':  { milestone: 'recording_confirmation', label: 'Recording confirmation' },
  '04-035':      { milestone: 'disbursement', label: 'Disbursement' },
  '04-035-TE':   { milestone: 'disbursement', label: 'Disbursement' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

async function resolveOrder(fileNumber: string) {
  const result = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber })
    .from(orders)
    .where(eq(orders.fileNumber, fileNumber))
    .limit(1);
  return result[0] ?? null;
}

async function downloadFromUrl(url: string): Promise<{ buffer: Buffer; filename: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} from ${url}`);

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const urlPath = new URL(url).pathname;
  const filename = urlPath.split('/').pop() ?? `document_${Date.now()}.pdf`;

  return { buffer, filename };
}

async function storeDocument(params: {
  orderId: number;
  fileNumber: string;
  buffer: Buffer;
  filename: string;
  category: 'prelim' | 'policy';
  sourceUrl: string;
}): Promise<{ documentId: number; storageKey: string; createdAt: Date }> {
  const ts = Date.now();
  const storageKey = `${params.category}/${params.fileNumber}/${ts}_${params.filename}`;

  const uploadResult = await s3Upload({
    key: storageKey,
    buffer: params.buffer,
    contentType: 'application/pdf',
  });

  if (!uploadResult.success) {
    throw new Error(uploadResult.error?.message ?? 'S3 upload failed');
  }

  const [doc] = await db
    .insert(documents)
    .values({
      orderId: params.orderId,
      category: params.category,
      filename: params.filename,
      originalFilename: params.filename,
      storageProvider: 's3',
      storageKey,
      contentType: 'application/pdf',
      sizeBytes: params.buffer.length,
      status: 'active',
      description: `Received via SoftPro ${params.category} webhook`,
      // SoftPro-origin — never write-back-push eligible
      isSyncedToSoftpro: true,
      softproSyncedAt: new Date(),
      createdBy: 'webhook:softpro',
    })
    .returning({ id: documents.id, createdAt: documents.createdAt });

  await db.insert(documentAudit).values({
    documentId: doc!.id,
    action: 'uploaded',
    byUserId: 'webhook:softpro',
    meta: {
      source: 'softpro_webhook',
      category: params.category,
      sourceUrl: params.sourceUrl,
      storageKey,
      sizeBytes: params.buffer.length,
    } as Record<string, unknown>,
  });

  return { documentId: doc!.id, storageKey, createdAt: doc!.createdAt };
}

// ─── Prelim Handler ─────────────────────────────────────────────────────────

export async function handlePrelimWebhook(payload: PrelimPayload): Promise<WebhookResult> {
  await logPrelimWebhookOp('webhook_prelim_received', null, {
    orderNumber: payload.OrderNumber,
    event: payload.Event ?? null,
    source: payload.Source ?? null,
    hasDocumentUrl: !!payload.DocumentUrl,
    dataCount: payload.data?.length ?? 0,
  }, true);

  const order = await resolveOrder(payload.OrderNumber);
  if (!order) {
    await logPrelimWebhookOp('webhook_prelim_error', null, {
      orderNumber: payload.OrderNumber,
      error: 'order_not_found',
    }, false);
    return { success: false, processed: 0, errors: [`Order not found: ${payload.OrderNumber}`] };
  }

  if ((await getSetting('prelim_summary_shut_off')) === 'true') {
    await logPrelimWebhookOp('webhook_prelim_skipped', order.id, {
      reason: 'prelim_summary_shut_off',
      orderNumber: payload.OrderNumber,
    }, true);
    return { success: true, processed: 0, errors: [] };
  }

  let processed = 0;
  const errors: string[] = [];
  const outcomes: NonNullable<WebhookResult['outcomes']> = [];
  const items = normalizePrelimItems(payload);

  for (const item of items) {
    try {
      const result = await ingestPrelimFromSoftPro({
        orderId: order.id,
        fileNumber: order.fileNumber,
        documentUrl: item.url,
        storedDocumentName: item.storedDocumentName,
        occurredAt: item.occurredAt,
        source: 'softpro_webhook',
        createdBy: 'webhook:softpro',
        deliver: true,
        triggeredBy: 'softpro_webhook',
      });

      if (result.outcome === 'deduped') {
        await logPrelimWebhookOp('webhook_prelim_deduped', order.id, {
          orderNumber: payload.OrderNumber,
          documentUrl: item.url,
          documentId: result.documentId,
          reason: result.reason,
        }, true);
        outcomes.push({
          url: item.url,
          outcome: 'deduped',
          documentId: result.documentId,
          reason: result.reason,
        });
        continue;
      }

      if (result.outcome === 'stale') {
        await logPrelimWebhookOp('webhook_prelim_deduped', order.id, {
          orderNumber: payload.OrderNumber,
          documentUrl: item.url,
          documentId: result.documentId,
          reason: result.reason,
          stale: true,
        }, true);
        outcomes.push({
          url: item.url,
          outcome: 'stale',
          documentId: result.documentId,
          reason: result.reason,
        });
        continue;
      }

      // ingested
      await logPrelimWebhookOp('webhook_prelim_ingested', order.id, {
        orderNumber: payload.OrderNumber,
        documentUrl: item.url,
        documentId: result.documentId,
        checksum: result.checksum,
        isUpdate: result.isUpdate,
      }, true);

      const delivered = result.delivery?.outcome === 'delivered';
      await logPrelimWebhookOp('webhook_prelim_delivered', order.id, {
        orderNumber: payload.OrderNumber,
        documentId: result.documentId,
        deliveryOutcome: result.delivery?.outcome ?? null,
        delivered,
        reason: result.delivery?.reason ?? null,
      }, delivered || result.delivery?.outcome === 'skipped_already_delivered'
        || result.delivery?.outcome === 'skipped_before_cutoff'
        || result.delivery?.outcome === 'not_armed'
        || result.delivery?.outcome === 'blocked_no_recipient');

      await db.insert(eventOutbox).values({
        eventType: 'order.document.received',
        orderId: order.id,
        payload: {
          documentId: result.documentId,
          category: 'prelim',
          fileNumber: order.fileNumber,
          isUpdate: result.isUpdate,
        } as Record<string, unknown>,
      });

      const analysisPromise = analyzePrelim({
        orderId: order.id,
        documentId: result.documentId,
        fileNumber: order.fileNumber,
        storageKey: result.storageKey,
        triggeredBy: 'webhook',
      }).catch((err) => {
        console.error('[TESSA] Webhook-triggered analysis failed:', err);
      });

      try {
        const nextServer = await import('next/server');
        const waitUntil = (nextServer as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
        if (typeof waitUntil === 'function') {
          waitUntil(analysisPromise);
        }
      } catch {
        /* next/server or waitUntil unavailable — promise runs best-effort */
      }

      processed++;
      outcomes.push({
        url: item.url,
        outcome: 'ingested',
        documentId: result.documentId,
        delivered,
        reason: result.delivery?.outcome,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Failed to process ${item.url}: ${message}`);
      outcomes.push({ url: item.url, outcome: 'error', reason: message });
      await logPrelimWebhookOp('webhook_prelim_error', order.id, {
        orderNumber: payload.OrderNumber,
        documentUrl: item.url,
        error: message,
      }, false);
    }
  }

  return { success: errors.length === 0, processed, errors, outcomes };
}

const SENT_FLAG_MAP: Record<string, 'lenderPolicySent' | 'ownerPolicySent' | 'supplementStatementSent'> = {
  lender_policy: 'lenderPolicySent',
  owner_policy: 'ownerPolicySent',
  supplement: 'supplementStatementSent',
};

// ─── Policy Handler ─────────────────────────────────────────────────────────

export async function handlePolicyWebhook(payload: PolicyPayload): Promise<WebhookResult> {
  const order = await resolveOrder(payload.OrderNumber);
  if (!order) {
    return { success: false, processed: 0, errors: [`Order not found: ${payload.OrderNumber}`] };
  }

  const [orderFlags] = await db
    .select({
      lenderPolicySent: orders.lenderPolicySent,
      ownerPolicySent: orders.ownerPolicySent,
      supplementStatementSent: orders.supplementStatementSent,
    })
    .from(orders)
    .where(eq(orders.id, order.id))
    .limit(1);

  let processed = 0;
  const errors: string[] = [];

  for (const item of payload.data) {
    try {
      const { classifyPolicyFile } = await import('@/lib/domain/notifications/policy-fetch');
      const { deliverPolicyDocument } = await import('@/lib/domain/notifications/policy-delivery-send');
      const kind = await classifyPolicyFile(order.fileNumber, item.FileName);

      const { buffer } = await downloadFromUrl(item.FileUrl);
      const { documentId } = await storeDocument({
        orderId: order.id,
        fileNumber: order.fileNumber,
        buffer,
        filename: item.FileName,
        category: 'policy',
        sourceUrl: item.FileUrl,
      });

      const flagKey = kind ? SENT_FLAG_MAP[kind] : undefined;
      if (flagKey && orderFlags?.[flagKey] === true) {
        try {
          await db.insert(vendorApiLogs).values({
            vendor: 'softpro', operation: 'policy_outbox_skipped', orderId: order.id,
            requestId: crypto.randomUUID(), startedAt: new Date(), endedAt: new Date(),
            success: true,
            requestMeta: { reason: `${String(flagKey)} already true`, kind, fileName: item.FileName } as Record<string, unknown>,
          });
        } catch { /* logging must not break the flow */ }
      } else {
        await deliverPolicyDocument({
          orderId: order.id,
          documentId,
          kind,
        });
      }

      processed++;
    } catch (err) {
      errors.push(`Failed to process ${item.FileName}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return { success: errors.length === 0, processed, errors };
}

// ─── Milestone Handler ──────────────────────────────────────────────────────

export async function handleMilestoneWebhook(payload: MilestonePayload): Promise<WebhookResult> {
  const order = await resolveOrder(payload.OrderNumber);
  if (!order) {
    return { success: false, processed: 0, errors: [`Order not found: ${payload.OrderNumber}`] };
  }

  const mapped = MILESTONE_MAP[payload.Id];
  const statusLabel = mapped?.milestone ?? payload.Id;
  const notes = mapped
    ? `${mapped.label}: ${payload.Status} (task ${payload.Id})`
    : `Task ${payload.Id}: ${payload.Status}`;

  const shutoffKey = statusLabel === 'recording_confirmation'
    ? 'recording_confirmation_shut_off'
    : statusLabel === 'disbursement'
      ? 'disburse_funds_shut_off'
      : null;

  if (shutoffKey && (await getSetting(shutoffKey)) === 'true') {
    try {
      await db.insert(orderStatusHistory).values({
        orderId: order.id, status: statusLabel, source: 'webhook', notes,
      });
      await db.insert(vendorApiLogs).values({
        vendor: 'softpro', operation: 'milestone_webhook_skipped', orderId: order.id,
        requestId: crypto.randomUUID(), startedAt: new Date(), endedAt: new Date(),
        success: true,
        requestMeta: { reason: shutoffKey, milestone: statusLabel, orderNumber: payload.OrderNumber } as Record<string, unknown>,
      });
    } catch { /* logging must not break the flow */ }
    return { success: true, processed: 1, errors: [] };
  }

  try {
    await db.insert(orderStatusHistory).values({
      orderId: order.id,
      status: statusLabel,
      source: 'webhook',
      notes,
    });

    await db.insert(eventOutbox).values({
      eventType: `order.milestone.${statusLabel}`,
      orderId: order.id,
      payload: {
        orderNumber: payload.OrderNumber,
        taskCode: payload.Id,
        taskStatus: payload.Status,
        milestone: statusLabel,
      } as Record<string, unknown>,
    });

    return { success: true, processed: 1, errors: [] };
  } catch (err) {
    return {
      success: false,
      processed: 0,
      errors: [err instanceof Error ? err.message : 'Unknown error'],
    };
  }
}
