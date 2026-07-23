import { z } from 'zod';
import { db } from '@/lib/db/client';
import { titlePointData } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  pollSearch,
  fetchResult,
  fetchImage,
  getTitlePointRecord,
} from '@/lib/domain/titlepoint/service';
import { fetchGrantDeed } from '@/lib/domain/titlepoint/grant-deed';
import { maybeEnqueueConfirmation } from '@/lib/domain/titlepoint/completion-checker';

// ─── Payload ────────────────────────────────────────────────────────────────

const payloadSchema = z.object({
  titlePointDataId: z.number().int().positive(),
});

export type TitlePointPollPayload = z.infer<typeof payloadSchema>;

// ─── Result ─────────────────────────────────────────────────────────────────

interface TitlePointPollResult {
  status: 'pending' | 'completed' | 'failed';
  requeued?: boolean;
  documentId?: number;
  error?: string;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * One-shot TitlePoint poll handler.
 * Does NOT enqueue status='queued' follow-up jobs (nothing drains that queue).
 * Still-pending searches are marked failed + retryable via retryFailedSearches.
 */
export async function handleTitlePointPoll(
  payload: Record<string, unknown>
): Promise<TitlePointPollResult> {
  const parsed = payloadSchema.parse(payload);
  const { titlePointDataId } = parsed;

  const pollResult = await pollSearch(titlePointDataId);

  if (pollResult.status === 'pending') {
    await db.update(titlePointData).set({
      status: 'failed',
      message: 'Still pending after poll — retry via manual TitlePoint retry (no queue consumer)',
      updatedAt: new Date(),
    }).where(eq(titlePointData.id, titlePointDataId));

    const record = await getTitlePointRecord(titlePointDataId);
    if (record?.orderId) {
      try { await maybeEnqueueConfirmation(record.orderId); } catch { /* best effort */ }
    }

    return {
      status: 'failed',
      requeued: false,
      error: 'Still pending — marked failed for manual retry (queue disabled)',
    };
  }

  if (pollResult.status === 'failed') {
    const record = await getTitlePointRecord(titlePointDataId);
    if (record?.orderId) {
      try { await maybeEnqueueConfirmation(record.orderId); } catch { /* best effort */ }
    }
    return { status: 'failed', error: pollResult.error };
  }

  // success — fetch result data
  const resultOutcome = await fetchResult(titlePointDataId);
  if (!resultOutcome.success) {
    const record = await getTitlePointRecord(titlePointDataId);
    if (record?.orderId) {
      try { await maybeEnqueueConfirmation(record.orderId); } catch { /* best effort */ }
    }
    return { status: 'failed', error: resultOutcome.error };
  }

  const record = await getTitlePointRecord(titlePointDataId);

  // Pre-order phase: no orderId yet — park at result_ready for later linking
  if (!record?.orderId) {
    return { status: 'completed' };
  }

  const imageOutcome = await fetchImage(titlePointDataId);
  if (!imageOutcome.success) {
    try { await maybeEnqueueConfirmation(record.orderId); } catch { /* best effort */ }
    return { status: 'failed', error: imageOutcome.error };
  }

  // After LV image is fetched, trigger Grant Deed extraction
  if (record.searchType === 'legal_vesting') {
    try {
      await fetchGrantDeed(titlePointDataId);
    } catch {
      // Grant deed failure must not fail the LV completion
    }
  }

  // After any search completes, check if confirmation can enqueue (complete / fail / timeout)
  try {
    await maybeEnqueueConfirmation(record.orderId);
  } catch {
    // Completion check failure must not block poll handler
  }

  return { status: 'completed', documentId: imageOutcome.documentId };
}
