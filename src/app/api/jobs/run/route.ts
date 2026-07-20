import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 300;
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { handleSyncOrders } from '@/lib/jobs/handlers/sync-orders';
import type { SyncOrdersPayload } from '@/lib/jobs/handlers/sync-orders';
import { handleSyncContacts } from '@/lib/jobs/handlers/sync-contacts';
import type { SyncContactsPayload } from '@/lib/jobs/handlers/sync-contacts';
import { handleTitlePointPoll } from '@/lib/jobs/handlers/titlepoint-poll';
import { ENRICH_ORDERS_RUNNING_WINDOW_MS, handleEnrichOrders } from '@/lib/jobs/handlers/enrich-orders';
import { handleEnrichOrderDetails } from '@/lib/jobs/handlers/enrich-order-details';
import { importOrdersFromSoftPro } from '@/lib/jobs/handlers/import-orders';
import { handleResolveOfficers } from '@/lib/jobs/handlers/resolve-order-officers';
import { handleFetchPrelims } from '@/lib/jobs/handlers/fetch-prelims';
import { handleVerifyOrderSync } from '@/lib/jobs/handlers/verify-order-sync';
import { handleSyncNewUsers } from '@/lib/jobs/handlers/sync-new-users';
import { handleSyncAllContacts, handleSyncContactType } from '@/lib/jobs/handlers/sync-all-contacts';
import { handleJobsWatchdog } from '@/lib/jobs/handlers/jobs-watchdog';
import { handleOpsDailyReport } from '@/lib/jobs/handlers/ops-daily-report';
import { handleRetrySoftProDocumentAttach } from '@/lib/jobs/handlers/retry-softpro-document-attach';
import { processOutboxEvents } from '@/lib/domain/notifications/service';

function formatTodayForImport(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}-${day}-${d.getFullYear()}`;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const querySchema = z.object({
  name: z.string().min(1),
});

const payloadSchema = z.record(z.string(), z.unknown()).default({});

// ─── Job Registry ────────────────────────────────────────────────────────────

type JobHandler = (payload: Record<string, unknown>) => Promise<unknown>;

const ENRICH_ORDER_JOB_NAMES = new Set(['softpro.enrich_orders', 'enrich-orders']);

const JOB_HANDLERS: Record<string, JobHandler> = {
  'softpro.sync_recent_orders': (payload) =>
    handleSyncOrders(payload as unknown as SyncOrdersPayload),
  'softpro.sync_contacts': (payload) =>
    handleSyncContacts(payload as unknown as SyncContactsPayload),
  'softpro.enrich_orders': (payload) =>
    handleEnrichOrders(payload),
  'softpro.enrich_order_details': () =>
    handleEnrichOrderDetails(),
  'enrich-orders': (payload) =>
    handleEnrichOrders(payload),
  'resolve_officers': () =>
    handleResolveOfficers(),
  'titlepoint.poll': (payload) =>
    handleTitlePointPoll(payload),
  'softpro.fetch_prelims': () =>
    handleFetchPrelims(),
  'softpro.verify_sync': () =>
    handleVerifyOrderSync(),
  'softpro.sync_new_users': () =>
    handleSyncNewUsers(),
  'softpro.sync_all_contacts': () =>
    handleSyncAllContacts(),
  'softpro.sync_contacts.order_contact_person': () =>
    handleSyncContactType('softpro.sync_contacts.order_contact_person'),
  'softpro.sync_contacts.title_officer': () =>
    handleSyncContactType('softpro.sync_contacts.title_officer'),
  'softpro.sync_contacts.escrow_officer': () =>
    handleSyncContactType('softpro.sync_contacts.escrow_officer'),
  'softpro.sync_contacts.sales_rep': () =>
    handleSyncContactType('softpro.sync_contacts.sales_rep'),
  'softpro.sync_contacts.escrow_company': () =>
    handleSyncContactType('softpro.sync_contacts.escrow_company'),
  'softpro.sync_contacts.lender': () =>
    handleSyncContactType('softpro.sync_contacts.lender'),
  'softpro.sync_contacts.mortgage_broker': () =>
    handleSyncContactType('softpro.sync_contacts.mortgage_broker'),
  'softpro.sync_contacts.selling_agent_broker': () =>
    handleSyncContactType('softpro.sync_contacts.selling_agent_broker'),
  'softpro.sync_contacts.underwriter': () =>
    handleSyncContactType('softpro.sync_contacts.underwriter'),
  'import-orders': (payload) => {
    const dateFrom = typeof payload.dateFrom === 'string' ? payload.dateFrom : formatTodayForImport();
    const dateTo = typeof payload.dateTo === 'string' ? payload.dateTo : formatTodayForImport();
    return importOrdersFromSoftPro({ dateFrom, dateTo });
  },
  'notifications.process_outbox': () =>
    processOutboxEvents(),
  'jobs.watchdog': () =>
    handleJobsWatchdog(),
  'ops.daily_report': () =>
    handleOpsDailyReport(),
  'softpro.retry_document_attach': () =>
    handleRetrySoftProDocumentAttach(),
};

// ─── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;

  const jobSecret = process.env.JOB_RUNNER_SECRET;
  if (jobSecret && authHeader === `Bearer ${jobSecret}`) return true;

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  return false;
}

// ─── Shared Execution ───────────────────────────────────────────────────────

async function executeJob(req: NextRequest, payload: Record<string, unknown>) {
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
    return NextResponse.json({ error: `Unknown job: ${jobName}` }, { status: 400 });
  }

  if (ENRICH_ORDER_JOB_NAMES.has(jobName)) {
    const activeSince = new Date(Date.now() - ENRICH_ORDERS_RUNNING_WINDOW_MS).toISOString();
    const [runningJob] = await db
      .select({
        id: jobs.id,
        jobType: jobs.jobType,
        startedAt: jobs.startedAt,
      })
      .from(jobs)
      .where(sql`
        ${jobs.status} = 'running'
        AND ${jobs.jobType} IN ('softpro.enrich_orders', 'enrich-orders')
        AND ${jobs.startedAt} >= ${activeSince}
      `)
      .limit(1);

    if (runningJob) {
      return NextResponse.json({
        success: true,
        job: jobName,
        skipped: true,
        reason: 'softpro.enrich_orders already running',
        runningJob,
      });
    }
  }

  const [job] = await db
    .insert(jobs)
    .values({ jobType: jobName, status: 'running', payload, startedAt: new Date(), attempts: 1 })
    .returning({ id: jobs.id });

  const jobId = job!.id;

  try {
    const handlerPayload = ENRICH_ORDER_JOB_NAMES.has(jobName)
      ? { ...payload, __jobId: jobId }
      : payload;
    const result = await handler(handlerPayload);
    try { await db.update(jobs).set({ status: 'completed', endedAt: new Date() }).where(eq(jobs.id, jobId)); } catch { /* tracking */ }
    return NextResponse.json({ success: true, job: jobName, jobId, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Job execution failed';
    try { await db.update(jobs).set({ status: 'failed', error: message, endedAt: new Date() }).where(eq(jobs.id, jobId)); } catch { /* tracking */ }
    return NextResponse.json({ error: 'Job execution failed', message, jobId }, { status: 500 });
  }
}

// ─── Route Handlers ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const payloadResult = payloadSchema.safeParse(rawBody);
  if (!payloadResult.success) {
    return NextResponse.json(
      { error: 'Invalid payload — expected a JSON object', details: payloadResult.error.issues },
      { status: 400 }
    );
  }
  return executeJob(req, payloadResult.data);
}

export async function GET(req: NextRequest) {
  return executeJob(req, {});
}
