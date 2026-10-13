import { and, asc, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema';
import { renderHazardSheet } from '@/lib/domain/concierge/nhd-bridge';

// ─── Finish any hazard preview whose sheet never reached the document ────────
//
// The same sweeper shape as concierge.tax_finish, for the same reason: the
// foreground render happens inside the operator's own request, and a closed
// tab, a frozen function or a failed upload would otherwise leave a stored PNG
// that no document shows. Profile 9 is the standing example — status said
// ready over a PDF written five seconds before its own search started.
//
// ─── IT ONLY SWEEPS 'fetched', NOT 'pending' ────────────────────────────────
//
// This is the one place it differs from the tax sweeper, and the difference
// comes from the vendor. TitlePoint tax is create → poll → fetch: a 'pending'
// row has a paid-for search sitting on their side with an id to resume, so the
// sweeper finishes it and must never start another.
//
// MyNHD answers in one round trip. There is no vendor-side id to resume into,
// so 'pending' here means only "we started and did not get back" — and the
// only safe action is to start over. That is free, so it is not dangerous;
// it is just not this job's business. Re-attempting a request an operator may
// have abandoned deliberately, on a schedule, against somebody else's service,
// is a thing to decide rather than a thing to default to. The row action
// re-attempts a 'pending' or 'failed' profile when somebody asks for it.
//
// So: 'fetched' has bytes we already hold and a document that does not show
// them. Rendering is free, idempotent, and reaches no vendor at all.

export const CONCIERGE_HAZARD_FINISH_JOB_TYPE = 'concierge.hazard_finish';

/** One run's ceiling. Each finish renders a PDF. */
const DEFAULT_BATCH = 10;
const TIME_BUDGET_MS = 240_000;

/**
 * Old enough that the request which started it has certainly gone, so this
 * does not race an operator's own render of the same profile.
 */
const SETTLE_MS = 30_000;

export interface ConciergeHazardFinishResult {
  considered: number;
  finished: number;
  stillWaiting: number;
  failed: number;
  outcomes: Array<{ profileId: number; status: string; message: string }>;
}

export async function handleConciergeHazardFinish(
  payload: Record<string, unknown> = {},
): Promise<ConciergeHazardFinishResult> {
  const limit = Number.isFinite(Number(payload.limit)) && Number(payload.limit) > 0
    ? Math.min(50, Math.floor(Number(payload.limit)))
    : DEFAULT_BATCH;

  const cutoff = new Date(Date.now() - SETTLE_MS);
  const deadline = Date.now() + TIME_BUDGET_MS;

  const rows = await db
    .select({
      id: conciergeProfiles.id,
      requestedAt: conciergeProfiles.hazardRequestedAt,
    })
    .from(conciergeProfiles)
    .where(and(
      // 'fetched' only. See the header for why 'pending' is left alone.
      inArray(conciergeProfiles.hazardStatus, ['fetched']),
      // The bytes have to exist, or there is nothing to put on a page.
      isNotNull(conciergeProfiles.hazardStorageKey),
    ))
    .orderBy(asc(conciergeProfiles.hazardRequestedAt))
    .limit(limit);

  const due = rows.filter((r) => !r.requestedAt || r.requestedAt <= cutoff);

  const out: ConciergeHazardFinishResult = {
    considered: due.length, finished: 0, stillWaiting: 0, failed: 0, outcomes: [],
  };

  for (const row of due) {
    if (Date.now() > deadline) break;
    try {
      const r = await renderHazardSheet(row.id);
      if (r.status === 'ready') out.finished += 1;
      else if (r.status === 'fetched') out.stillWaiting += 1;
      else out.failed += 1;
      out.outcomes.push({ profileId: row.id, status: r.status, message: r.message });
    } catch (err) {
      // One profile's failure must not strand the rest of the batch.
      out.failed += 1;
      out.outcomes.push({
        profileId: row.id,
        status: 'error',
        message: err instanceof Error ? err.message : 'renderHazardSheet threw',
      });
    }
  }

  return out;
}
