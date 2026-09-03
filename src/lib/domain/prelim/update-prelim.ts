import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documents, jobs } from '@/lib/db/schema';

export const UPDATE_PRELIM_JOB_TYPE = 'prelim.update';

/** SoftPro task code for Update Prelim. Legacy: SOFTPRO_TASK_ID['update_prelim']. */
export const UPDATE_PRELIM_TASK_ID = '03-005';

/**
 * Legacy sends FolderName 'prelim' and its prelims are on the files today, so
 * this string is proven against the vendor. Where SoftPro actually files it
 * depends on order type — "Title & Escrow" nests under
 * `1 - Title Documents\3 - Production Documents`, everything else lands in a
 * root-level `3 - Production Documents`. We do not control that mapping and
 * must not guess at it: the staging probe records where it landed for both
 * order types.
 */
export const UPDATE_PRELIM_FOLDER_NAME = 'prelim';

export const UPDATE_PRELIM_MAX_ATTEMPTS = 3;

/** Operator-entered note, capped so a paste cannot blow the SoftPro payload. */
export const PRELIM_NOTE_SUBJECT_MAX = 200;
export const PRELIM_NOTE_BODY_MAX = 4000;

/**
 * AddNotes takes OrderNumber / Text / Id — there is no Subject field on our
 * client, and legacy commented its Subject assignment out without recording
 * why. Prepending keeps the operator's subject in SoftPro regardless of what
 * the vendor does with a field we have never proven accepts anything.
 *
 * If the staging probe shows a real Subject field, that is a finding to
 * report, not a switch to flip — keep prepending until someone has read a
 * note in SoftPro's own UI and confirmed the subject renders there.
 */
export function buildPrelimNoteText(input: { subject: string; note: string }): string {
  const subject = input.subject.trim();
  const note = input.note.trim();
  if (!subject) return note;
  if (!note) return subject;
  return `${subject}\n\n${note}`;
}

/**
 * Legacy used `YmdHis_name.pdf` — one-second resolution, no order component,
 * so two reps uploading in the same second collided in one flat directory.
 * Order number plus a random suffix; the storage key is `prelim/<filename>`.
 */
export function prelimUploadFilename(orderNumber: string, now = new Date()): string {
  const safeOrder = orderNumber.replace(/[^A-Za-z0-9-]/g, '') || 'unknown';
  const stamp = now.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `prelim_${safeOrder}_${stamp}_${rand}.pdf`;
}

/**
 * Mark every other active prelim on the order superseded and point it at the
 * row that replaced it. Legacy stacked active prelim rows forever, so
 * "the prelim" became whichever row sorted first.
 *
 * Our side only. SoftPro has no delete on this path, so prior prelims stay on
 * the vendor file — same as CPL. Do not try to clean SoftPro up.
 */
export async function supersedePriorPrelims(
  orderId: number,
  currentDocumentId: number,
): Promise<number> {
  const rows = await db
    .update(documents)
    .set({
      supersededAt: new Date(),
      supersededByDocumentId: currentDocumentId,
      updatedAt: new Date(),
    })
    .where(and(
      eq(documents.orderId, orderId),
      eq(documents.category, 'prelim'),
      eq(documents.status, 'active'),
      ne(documents.id, currentDocumentId),
      isNull(documents.supersededAt),
    ))
    .returning({ id: documents.id });

  return rows.length;
}

export interface UpdatePrelimJobPayload {
  documentId: number;
  orderId: number;
  orderNumber: string;
  subject: string;
  note: string;
  requestedBy: string;
  [key: string]: unknown;
}

/**
 * Queue the SoftPro half and return. The route must not block on it: three
 * sequential SoftPro calls do not fit inside Vercel's 300s ceiling, and a
 * timeout mid-flight is what produced duplicate vendor work before.
 */
export async function enqueueUpdatePrelimJob(
  payload: UpdatePrelimJobPayload,
): Promise<{ jobId: number }> {
  const [job] = await db
    .insert(jobs)
    .values({
      jobType: UPDATE_PRELIM_JOB_TYPE,
      orderId: payload.orderId,
      payload,
      status: 'queued',
      attempts: 0,
      maxAttempts: UPDATE_PRELIM_MAX_ATTEMPTS,
      nextRetryAt: new Date(),
    })
    .returning({ id: jobs.id });

  return { jobId: job!.id };
}

export type UpdatePrelimJobState = 'queued' | 'running' | 'completed' | 'failed' | 'retrying';

/**
 * 'confirmed' — the prelim listing returned the name we sent.
 * 'accepted'  — SoftPro took the write; the listing did not show it.
 *
 * Held separately from the job status on purpose. A job can complete in either
 * state, and only this field says which. Null until the listing has been read.
 */
export type UpdatePrelimVerifyState = 'confirmed' | 'accepted' | 'failed';

export interface UpdatePrelimStatus {
  jobId: number;
  status: UpdatePrelimJobState;
  verifyState: UpdatePrelimVerifyState | null;
  error: string | null;
  documentId: number | null;
  createdAt: Date;
}

/** Latest Update Prelim job for the order, so the row can show real status. */
export async function getUpdatePrelimStatus(
  orderId: number,
): Promise<UpdatePrelimStatus | null> {
  const [row] = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      error: jobs.error,
      payload: jobs.payload,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(and(
      eq(jobs.jobType, UPDATE_PRELIM_JOB_TYPE),
      eq(jobs.orderId, orderId),
    ))
    .orderBy(desc(jobs.id))
    .limit(1);

  if (!row) return null;

  const payload = (row.payload ?? {}) as Partial<UpdatePrelimJobPayload> & {
    progress?: { verifyState?: unknown };
  };
  const rawState = payload.progress?.verifyState;
  const verifyState = rawState === 'confirmed' || rawState === 'accepted' || rawState === 'failed'
    ? rawState
    : null;

  return {
    jobId: row.id,
    status: row.status as UpdatePrelimJobState,
    verifyState,
    error: row.error ?? null,
    documentId: typeof payload.documentId === 'number' ? payload.documentId : null,
    createdAt: row.createdAt,
  };
}

/** An in-flight job for this order — the route refuses a second submit. */
export async function findActiveUpdatePrelimJob(
  orderId: number,
): Promise<{ id: number } | null> {
  const rows = await db.execute(sql`
    SELECT id
    FROM jobs
    WHERE job_type = ${UPDATE_PRELIM_JOB_TYPE}
      AND order_id = ${orderId}
      AND status IN ('queued', 'retrying', 'running')
    ORDER BY id DESC
    LIMIT 1
  `) as unknown as Array<{ id: number }>;

  return rows.length > 0 ? { id: rows[0]!.id } : null;
}
