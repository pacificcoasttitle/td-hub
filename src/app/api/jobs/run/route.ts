import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { handleSyncOrders } from '@/lib/jobs/handlers/sync-orders';
import type { SyncOrdersPayload } from '@/lib/jobs/handlers/sync-orders';
import { handleSyncContacts } from '@/lib/jobs/handlers/sync-contacts';
import type { SyncContactsPayload } from '@/lib/jobs/handlers/sync-contacts';
import { handleTitlePointPoll } from '@/lib/jobs/handlers/titlepoint-poll';
import { processOutboxEvents } from '@/lib/domain/notifications/service';

// ─── Validation ──────────────────────────────────────────────────────────────

const querySchema = z.object({
  name: z.string().min(1),
});

const payloadSchema = z.record(z.string(), z.unknown()).default({});

// ─── Job Registry ────────────────────────────────────────────────────────────

type JobHandler = (payload: Record<string, unknown>) => Promise<unknown>;

const JOB_HANDLERS: Record<string, JobHandler> = {
  'softpro.sync_recent_orders': (payload) =>
    handleSyncOrders(payload as unknown as SyncOrdersPayload),
  'softpro.sync_contacts': (payload) =>
    handleSyncContacts(payload as unknown as SyncContactsPayload),
  'titlepoint.poll': (payload) =>
    handleTitlePointPoll(payload),
  'notifications.process_outbox': () =>
    processOutboxEvents(),
};

// ─── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.JOB_RUNNER_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  return authHeader === `Bearer ${secret}`;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nameResult = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams)
  );
  if (!nameResult.success) {
    return NextResponse.json(
      { error: 'Missing or invalid "name" query parameter', details: nameResult.error.issues },
      { status: 400 }
    );
  }

  const { name: jobName } = nameResult.data;

  const handler = JOB_HANDLERS[jobName];
  if (!handler) {
    return NextResponse.json(
      { error: `Unknown job: ${jobName}` },
      { status: 400 }
    );
  }

  const rawBody = await req.json().catch(() => ({}));
  const payloadResult = payloadSchema.safeParse(rawBody);
  if (!payloadResult.success) {
    return NextResponse.json(
      { error: 'Invalid payload — expected a JSON object', details: payloadResult.error.issues },
      { status: 400 }
    );
  }
  const payload = payloadResult.data;

  const [job] = await db
    .insert(jobs)
    .values({
      jobType: jobName,
      status: 'running',
      payload,
      startedAt: new Date(),
      attempts: 1,
    })
    .returning({ id: jobs.id });

  const jobId = job!.id;

  try {
    const result = await handler(payload);

    try {
      await db.update(jobs).set({ status: 'completed', endedAt: new Date() }).where(eq(jobs.id, jobId));
    } catch { /* Don't let tracking failure mask success */ }

    return NextResponse.json({ success: true, job: jobName, jobId, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Job execution failed';

    try {
      await db.update(jobs).set({ status: 'failed', error: message, endedAt: new Date() }).where(eq(jobs.id, jobId));
    } catch { /* Don't let tracking failure mask the real error */ }

    return NextResponse.json(
      { error: 'Job execution failed', message, jobId },
      { status: 500 }
    );
  }
}
