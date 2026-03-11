import { z } from 'zod';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import {
  pollSearch,
  fetchResult,
  fetchImage,
} from '@/lib/domain/titlepoint/service';

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

const POLL_DELAY_MS = 30_000;

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handleTitlePointPoll(
  payload: Record<string, unknown>
): Promise<TitlePointPollResult> {
  const parsed = payloadSchema.parse(payload);
  const { titlePointDataId } = parsed;

  const pollResult = await pollSearch(titlePointDataId);

  if (pollResult.status === 'pending') {
    await db.insert(jobs).values({
      jobType: 'titlepoint.poll',
      payload: { titlePointDataId } as Record<string, unknown>,
      status: 'queued',
      nextRetryAt: new Date(Date.now() + POLL_DELAY_MS),
    });

    return { status: 'pending', requeued: true };
  }

  if (pollResult.status === 'failed') {
    return { status: 'failed', error: pollResult.error };
  }

  // success — fetch result data, then image
  const resultOutcome = await fetchResult(titlePointDataId);
  if (!resultOutcome.success) {
    return { status: 'failed', error: resultOutcome.error };
  }

  const imageOutcome = await fetchImage(titlePointDataId);
  if (!imageOutcome.success) {
    return { status: 'failed', error: imageOutcome.error };
  }

  return { status: 'completed', documentId: imageOutcome.documentId };
}
