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
import {
  findActiveTitlePointDrain,
  handleTitlePointDrain,
} from '@/lib/jobs/handlers/titlepoint-drain';
import { ENRICH_ORDERS_RUNNING_WINDOW_MS, handleEnrichOrders } from '@/lib/jobs/handlers/enrich-orders';
import { handleEnrichOrderDetails } from '@/lib/jobs/handlers/enrich-order-details';
import { handleBackfillSitexProperty } from '@/lib/jobs/handlers/backfill-sitex-property';
import { importOrdersFromSoftPro } from '@/lib/jobs/handlers/import-orders';
import { handleResolveOfficers } from '@/lib/jobs/handlers/resolve-order-officers';
import { handleFetchPrelims } from '@/lib/jobs/handlers/fetch-prelims';
import { handleVerifyOrderSync } from '@/lib/jobs/handlers/verify-order-sync';
import { handleLookbackSync } from '@/lib/jobs/handlers/lookback-sync';
import { handleSyncNewUsers } from '@/lib/jobs/handlers/sync-new-users';
import {
  CONTACT_SYNC_JOB_CONFIGS,
  handleSyncAllContacts,
  handleSyncContactType,
} from '@/lib/jobs/handlers/sync-all-contacts';
import type { SyncContactTypePayload } from '@/lib/jobs/handlers/sync-all-contacts';
import { handleJobsWatchdog } from '@/lib/jobs/handlers/jobs-watchdog';
import { handleOpsDailyReport } from '@/lib/jobs/handlers/ops-daily-report';
import { handleRetrySoftProDocumentAttach } from '@/lib/jobs/handlers/retry-softpro-document-attach';
import { handleOutstandingDocumentsAlert } from '@/lib/jobs/handlers/outstanding-documents-alert';
import { handleRetryHeldPrelimWatchedTen } from '@/lib/jobs/handlers/retry-held-prelim-watched-ten';
import { handleRetryHeldPrelimNoRecipient } from '@/lib/jobs/handlers/retry-held-prelim-no-recipient';
import { handlePartyWizardInvite } from '@/lib/jobs/handlers/party-wizard-invite';
import { processOutboxEvents } from '@/lib/domain/notifications/service';
import { recordJobCompletion } from '@/lib/jobs/record-result';

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
const TITLEPOINT_DRAIN_JOB_NAMES = new Set(['titlepoint.drain']);
/**
 * Jobs that need their own job id, because the runner does not persist handler
 * return values — `jobs.payload` holds only the input. The drift detector writes
 * its counts back onto its own row so the ops panel can trend them.
 */
const NEEDS_JOB_ID = new Set([
  'softpro.verify_sync',
  'softpro.lookback_sync',
  // Needs its row to record PER-DAY coverage: which slices of the trailing
  // window were read, which failed, and which came back at SoftPro's silent row
  // cap. A cron run's HTTP response is read by nobody, so without this the only
  // record of a lost day would scroll out of the runtime log.
  'softpro.sync_recent_orders',
  // Needs its row to record a REFUSAL. A run that declined to send otherwise
  // looks exactly like a run that found nothing to do.
  'party_wizard.invite',
  'prelim.retry_held_watched_ten',
  'prelim.retry_held_no_recipient',
  // Need their rows to record a PARTIAL failure. These handlers collect
  // per-row errors and return normally, so the runner marks them `completed`
  // and writes no error — which is how the escrow-officer feed reported clean
  // runs while four officers silently stopped updating.
  ...Object.keys(CONTACT_SYNC_JOB_CONFIGS),
]);

const JOB_HANDLERS: Record<string, JobHandler> = {
  'softpro.sync_recent_orders': (payload) =>
    handleSyncOrders(payload as unknown as SyncOrdersPayload),
  'softpro.sync_contacts': (payload) =>
    handleSyncContacts(payload as unknown as SyncContactsPayload),
  'softpro.enrich_orders': (payload) =>
    handleEnrichOrders(payload),
  'softpro.enrich_order_details': () =>
    handleEnrichOrderDetails(),
  'sitex.backfill_property': () =>
    handleBackfillSitexProperty(),
  'enrich-orders': (payload) =>
    handleEnrichOrders(payload),
  'resolve_officers': () =>
    handleResolveOfficers(),
  'titlepoint.poll': (payload) =>
    handleTitlePointPoll(payload),
  'titlepoint.drain': (payload) =>
    handleTitlePointDrain(payload),
  'softpro.fetch_prelims': () =>
    handleFetchPrelims(),
  'softpro.verify_sync': (payload) =>
    handleVerifyOrderSync(payload),
  'softpro.lookback_sync': (payload) =>
    handleLookbackSync(payload),
  'softpro.sync_new_users': () =>
    handleSyncNewUsers(),
  'softpro.sync_all_contacts': () =>
    handleSyncAllContacts(),
  'softpro.sync_contacts.order_contact_person': (payload) =>
    handleSyncContactType('softpro.sync_contacts.order_contact_person', payload as SyncContactTypePayload),
  'softpro.sync_contacts.title_officer': (payload) =>
    handleSyncContactType('softpro.sync_contacts.title_officer', payload as SyncContactTypePayload),
  'softpro.sync_contacts.escrow_officer': (payload) =>
    handleSyncContactType('softpro.sync_contacts.escrow_officer', payload as SyncContactTypePayload),
  'softpro.sync_contacts.sales_rep': (payload) =>
    handleSyncContactType('softpro.sync_contacts.sales_rep', payload as SyncContactTypePayload),
  'softpro.sync_contacts.escrow_company': (payload) =>
    handleSyncContactType('softpro.sync_contacts.escrow_company', payload as SyncContactTypePayload),
  'softpro.sync_contacts.lender': (payload) =>
    handleSyncContactType('softpro.sync_contacts.lender', payload as SyncContactTypePayload),
  'softpro.sync_contacts.mortgage_broker': (payload) =>
    handleSyncContactType('softpro.sync_contacts.mortgage_broker', payload as SyncContactTypePayload),
  'softpro.sync_contacts.selling_agent_broker': (payload) =>
    handleSyncContactType('softpro.sync_contacts.selling_agent_broker', payload as SyncContactTypePayload),
  'softpro.sync_contacts.underwriter': (payload) =>
    handleSyncContactType('softpro.sync_contacts.underwriter', payload as SyncContactTypePayload),
  'import-orders': (payload) => {
    const dateFrom = typeof payload.dateFrom === 'string' ? payload.dateFrom : formatTodayForImport();
    const dateTo = typeof payload.dateTo === 'string' ? payload.dateTo : formatTodayForImport();
    return importOrdersFromSoftPro({ dateFrom, dateTo });
  },
  'notifications.process_outbox': () =>
    processOutboxEvents(),
  'party_wizard.invite': (payload) =>
    handlePartyWizardInvite(payload),
  'jobs.watchdog': () =>
    handleJobsWatchdog(),
  'ops.daily_report': () =>
    handleOpsDailyReport(),
  'softpro.retry_document_attach': () =>
    handleRetrySoftProDocumentAttach(),
  'notifications.outstanding_documents_alert': () =>
    handleOutstandingDocumentsAlert(),
  'prelim.retry_held_watched_ten': () =>
    handleRetryHeldPrelimWatchedTen(),
  'prelim.retry_held_no_recipient': (payload) =>
    handleRetryHeldPrelimNoRecipient(payload),
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

  if (TITLEPOINT_DRAIN_JOB_NAMES.has(jobName)) {
    const runningJob = await findActiveTitlePointDrain(null);
    if (runningJob) {
      return NextResponse.json({
        success: true,
        job: jobName,
        skipped: true,
        reason: 'titlepoint.drain already running',
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
    const handlerPayload = ENRICH_ORDER_JOB_NAMES.has(jobName) || TITLEPOINT_DRAIN_JOB_NAMES.has(jobName) || NEEDS_JOB_ID.has(jobName)
      ? { ...payload, __jobId: jobId }
      : payload;
    const result = await handler(handlerPayload);
    // Saves the handler's result on the row as well as the status. The result
    // used to reach only this HTTP response, which nobody reads for a cron run.
    await recordJobCompletion(jobId, result);
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
