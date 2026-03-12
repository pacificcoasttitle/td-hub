import { z } from 'zod';
import { db } from '@/lib/db/client';
import { documents, documentAudit, orders, orderStatusHistory, eventOutbox } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { uploadFile as s3Upload } from '@/lib/integrations/s3/client';
import { analyzePrelim } from '@/lib/domain/tessa/service';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const prelimPayloadSchema = z.object({
  OrderNumber: z.string().min(1),
  Status: z.string().optional(),
  data: z.array(z.string().url()),
});

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
}): Promise<{ documentId: number }> {
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
      createdBy: 'webhook:softpro',
    })
    .returning({ id: documents.id });

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

  return { documentId: doc!.id };
}

// ─── Prelim Handler ─────────────────────────────────────────────────────────

export async function handlePrelimWebhook(payload: PrelimPayload): Promise<WebhookResult> {
  const order = await resolveOrder(payload.OrderNumber);
  if (!order) {
    return { success: false, processed: 0, errors: [`Order not found: ${payload.OrderNumber}`] };
  }

  let processed = 0;
  const errors: string[] = [];

  for (const url of payload.data) {
    try {
      const { buffer, filename } = await downloadFromUrl(url);
      const { documentId } = await storeDocument({
        orderId: order.id,
        fileNumber: order.fileNumber,
        buffer,
        filename,
        category: 'prelim',
        sourceUrl: url,
      });

      await db.insert(eventOutbox).values({
        eventType: 'order.document.received',
        orderId: order.id,
        payload: { documentId, category: 'prelim', fileNumber: order.fileNumber } as Record<string, unknown>,
      });

      try { analyzePrelim(documentId); } catch { /* fire and forget */ }

      processed++;
    } catch (err) {
      errors.push(`Failed to process ${url}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return { success: errors.length === 0, processed, errors };
}

// ─── Policy Handler ─────────────────────────────────────────────────────────

export async function handlePolicyWebhook(payload: PolicyPayload): Promise<WebhookResult> {
  const order = await resolveOrder(payload.OrderNumber);
  if (!order) {
    return { success: false, processed: 0, errors: [`Order not found: ${payload.OrderNumber}`] };
  }

  let processed = 0;
  const errors: string[] = [];

  for (const item of payload.data) {
    try {
      const { buffer } = await downloadFromUrl(item.FileUrl);
      const { documentId } = await storeDocument({
        orderId: order.id,
        fileNumber: order.fileNumber,
        buffer,
        filename: item.FileName,
        category: 'policy',
        sourceUrl: item.FileUrl,
      });

      await db.insert(eventOutbox).values({
        eventType: 'order.document.received',
        orderId: order.id,
        payload: { documentId, category: 'policy', fileNumber: order.fileNumber } as Record<string, unknown>,
      });

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
