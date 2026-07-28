import {
  pollSearch,
  fetchResult,
  fetchImage,
  getTitlePointRecord,
} from '@/lib/domain/titlepoint/service';
import { fetchGrantDeed } from '@/lib/domain/titlepoint/grant-deed';
import { maybeEnqueueConfirmation } from '@/lib/domain/titlepoint/completion-checker';

export interface TitlePointWorkResult {
  status: 'pending' | 'completed' | 'failed';
  requeued?: boolean;
  documentId?: number;
  error?: string;
  skipped?: boolean;
}

/**
 * Exact TitlePoint finish pipeline for a single title_point_data row.
 * Relocates existing poll → result → fetchImage → grant-deed → confirmation
 * steps without touching TP client/parser/grant-deed internals.
 *
 * Idempotent: completed rows are never re-generated.
 * Grant deed runs only after LV image completion (same as today).
 */
export async function processTitlePointWork(
  titlePointDataId: number,
): Promise<TitlePointWorkResult> {
  const record = await getTitlePointRecord(titlePointDataId);
  if (!record) {
    return { status: 'failed', error: 'TitlePoint record not found' };
  }

  // Completed row: never re-generate; still nudge confirmation (outbox-deduped).
  if (record.status === 'completed') {
    if (record.orderId) {
      try { await maybeEnqueueConfirmation(record.orderId); } catch { /* best effort */ }
    }
    return { status: 'completed', skipped: true };
  }

  if (record.searchType === 'grant_deed') {
    return {
      status: 'failed',
      error: 'Grant deed must use fetchGrantDeed via legal_vesting completion, not the generic worker',
    };
  }

  // Already have result XML — only image/upload remains (OC-1 park path).
  if (record.status === 'result_ready') {
    return finishFromResultReady(titlePointDataId, record.orderId, record.searchType);
  }

  // Poll may already have succeeded ('ready') — fetch result then image.
  if (record.status === 'ready') {
    const resultOutcome = await fetchResult(titlePointDataId);
    if (!resultOutcome.success) {
      if (record.orderId) {
        try { await maybeEnqueueConfirmation(record.orderId); } catch { /* best effort */ }
      }
      return { status: 'failed', error: resultOutcome.error };
    }
    const after = await getTitlePointRecord(titlePointDataId);
    if (!after?.orderId) {
      return { status: 'completed' }; // pre-order park
    }
    return finishFromResultReady(titlePointDataId, after.orderId, after.searchType);
  }

  // pending / processing / failed-retry: poll → result → image
  const pollResult = await pollSearch(titlePointDataId);

  if (pollResult.status === 'pending') {
    // Still processing at TitlePoint — retryable, not a hard fail.
    return {
      status: 'pending',
      requeued: true,
      error: 'Still pending at TitlePoint',
    };
  }

  if (pollResult.status === 'failed') {
    if (record.orderId) {
      try { await maybeEnqueueConfirmation(record.orderId); } catch { /* best effort */ }
    }
    return { status: 'failed', error: pollResult.error };
  }

  const resultOutcome = await fetchResult(titlePointDataId);
  if (!resultOutcome.success) {
    const latest = await getTitlePointRecord(titlePointDataId);
    if (latest?.orderId) {
      try { await maybeEnqueueConfirmation(latest.orderId); } catch { /* best effort */ }
    }
    return { status: 'failed', error: resultOutcome.error };
  }

  const afterResult = await getTitlePointRecord(titlePointDataId);

  // Pre-order phase: no orderId yet — park at result_ready for later linking
  if (!afterResult?.orderId) {
    return { status: 'completed' };
  }

  return finishFromResultReady(
    titlePointDataId,
    afterResult.orderId,
    afterResult.searchType,
  );
}

async function finishFromResultReady(
  titlePointDataId: number,
  orderId: number | null | undefined,
  searchType: string | null | undefined,
): Promise<TitlePointWorkResult> {
  if (!orderId) {
    return { status: 'failed', error: 'No orderId — cannot upload document yet' };
  }

  // Re-check: another worker/short-sync may have finished while we waited.
  const latest = await getTitlePointRecord(titlePointDataId);
  if (latest?.status === 'completed') {
    try { await maybeEnqueueConfirmation(orderId); } catch { /* best effort */ }
    return { status: 'completed', skipped: true };
  }

  const imageOutcome = await fetchImage(titlePointDataId);
  if (!imageOutcome.success) {
    try { await maybeEnqueueConfirmation(orderId); } catch { /* best effort */ }
    // "still processing" image → retryable pending; hard errors → failed
    const retryable = /still processing/i.test(imageOutcome.error ?? '');
    return {
      status: retryable ? 'pending' : 'failed',
      requeued: retryable,
      error: imageOutcome.error,
    };
  }

  // After LV image is fetched, trigger Grant Deed extraction (LV→GD dependency).
  if (searchType === 'legal_vesting') {
    try {
      await fetchGrantDeed(titlePointDataId);
    } catch {
      // Grant deed failure must not fail the LV completion
    }
  }

  try {
    await maybeEnqueueConfirmation(orderId);
  } catch {
    // Completion check failure must not block worker
  }

  return { status: 'completed', documentId: imageOutcome.documentId };
}
