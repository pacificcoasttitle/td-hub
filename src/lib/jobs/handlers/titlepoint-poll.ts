import { z } from 'zod';
import { processTitlePointWork } from '@/lib/domain/titlepoint/process-work';

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
  skipped?: boolean;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * One-shot TitlePoint work handler (manual /api/jobs/run?name=titlepoint.poll).
 * The cron path uses titlepoint.drain which claims queued jobs atomically.
 * Both call the same processTitlePointWork pipeline.
 */
export async function handleTitlePointPoll(
  payload: Record<string, unknown>
): Promise<TitlePointPollResult> {
  const parsed = payloadSchema.parse(payload);
  return processTitlePointWork(parsed.titlePointDataId);
}
