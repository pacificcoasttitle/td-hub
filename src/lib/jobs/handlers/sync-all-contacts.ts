import { db } from '@/lib/db/client';
import { contactSyncState } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  fetchSyncContactRows,
  getSyncContactLookupCode,
  sortSyncContactRows,
  syncContactRows,
  type SyncContactEntityType,
  type SyncContactsResult,
} from './sync-contacts';

const CONTACT_SYNC_COOLDOWN_MS = 16 * 60 * 60 * 1000;
// Contact lookup tables are thousands of rows; 3k keeps each invocation bounded
// while allowing the largest type to finish within the 24h freshness target.
const CONTACT_SYNC_BATCH_SIZE = 3000;

export const CONTACT_SYNC_JOB_CONFIGS = {
  'softpro.sync_contacts.order_contact_person': 'Order Contact - Person',
  'softpro.sync_contacts.title_officer': 'Title Officer',
  'softpro.sync_contacts.escrow_officer': 'Escrow Officer',
  'softpro.sync_contacts.sales_rep': 'Sales Rep',
  'softpro.sync_contacts.escrow_company': 'Escrow Company',
  'softpro.sync_contacts.lender': 'Lender',
  'softpro.sync_contacts.mortgage_broker': 'Mortgage Broker',
  'softpro.sync_contacts.selling_agent_broker': 'SellingAgentBroker',
  'softpro.sync_contacts.underwriter': 'Underwriter',
} as const satisfies Record<string, SyncContactEntityType>;

export interface SyncAllContactsResult {
  results: SyncContactsResult[];
  totalCreated: number;
  totalUpdated: number;
  totalErrors: number;
}

export interface SyncContactTypeResult extends SyncContactsResult {
  jobType: string;
  status: 'completed' | 'paused' | 'skipped';
  processed: number;
  cursorLookupCode: string | null;
  nextAllowedAt: string | null;
}

export async function handleSyncAllContacts(): Promise<SyncAllContactsResult> {
  const now = new Date();
  const stateRows = await db.select().from(contactSyncState);
  const stateByType = new Map(stateRows.map((row) => [row.entityType, row]));
  const dueJob = Object.entries(CONTACT_SYNC_JOB_CONFIGS).find(([, entityType]) => {
    const state = stateByType.get(entityType);
    return !state?.nextAllowedAt || state.nextAllowedAt <= now;
  });

  if (!dueJob) {
    return { results: [], totalCreated: 0, totalUpdated: 0, totalErrors: 0 };
  }

  const result = await handleSyncContactType(dueJob[0] as keyof typeof CONTACT_SYNC_JOB_CONFIGS);
  return {
    results: [result],
    totalCreated: result.created,
    totalUpdated: result.updated,
    totalErrors: result.errors.length,
  };
}

export async function handleSyncContactType(
  jobType: keyof typeof CONTACT_SYNC_JOB_CONFIGS
): Promise<SyncContactTypeResult> {
  const entityType = CONTACT_SYNC_JOB_CONFIGS[jobType];
  const now = new Date();
  const [existingState] = await db
    .select()
    .from(contactSyncState)
    .where(eq(contactSyncState.entityType, entityType))
    .limit(1);

  if (existingState?.nextAllowedAt && existingState.nextAllowedAt > now) {
    return {
      jobType,
      entityType,
      status: 'skipped',
      totalFetched: existingState.totalFetched,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      processed: 0,
      cursorLookupCode: existingState.cursorLookupCode,
      nextAllowedAt: existingState.nextAllowedAt.toISOString(),
    };
  }

  await db
    .insert(contactSyncState)
    .values({
      entityType,
      jobType,
      status: 'running',
      lastStartedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: contactSyncState.entityType,
      set: {
        jobType,
        status: 'running',
        lastStartedAt: now,
        lastError: null,
        updatedAt: now,
      },
    });

  try {
    const fetched = await fetchSyncContactRows(entityType);
    if (fetched.error) {
      throw new Error(`${jobType}: ${fetched.error}`);
    }

    const cursor = existingState?.cursorLookupCode ?? null;
    const orderedRows = sortSyncContactRows(entityType, fetched.items)
      .map((item) => ({ item, lookupCode: getSyncContactLookupCode(entityType, item) }))
      .filter((row) => row.lookupCode !== null && (!cursor || row.lookupCode > cursor));

    const batch = orderedRows.slice(0, CONTACT_SYNC_BATCH_SIZE);
    if (batch.length === 0) {
      const nextAllowedAt = new Date(Date.now() + CONTACT_SYNC_COOLDOWN_MS);
      const empty = {
        jobType,
        entityType,
        status: 'completed' as const,
        totalFetched: fetched.items.length,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [],
        processed: 0,
        cursorLookupCode: null,
        nextAllowedAt: nextAllowedAt.toISOString(),
      };

      await db.update(contactSyncState)
        .set({
          status: 'completed',
          cursorLookupCode: null,
          lastCompletedAt: new Date(),
          nextAllowedAt,
          totalFetched: fetched.items.length,
          lastResult: empty,
          updatedAt: new Date(),
        })
        .where(eq(contactSyncState.entityType, entityType));

      return empty;
    }

    const result = await syncContactRows(
      entityType,
      batch.map((row) => row.item),
      { deactivateExistingSalesReps: entityType === 'Sales Rep' && !cursor },
    );

    const processed = batch.length;
    const lastCursor = batch[batch.length - 1]?.lookupCode ?? cursor;
    const completed = processed === orderedRows.length;
    const nextAllowedAt = completed ? new Date(Date.now() + CONTACT_SYNC_COOLDOWN_MS) : null;
    const status = completed ? 'completed' : 'paused';
    const response: SyncContactTypeResult = {
      ...result,
      jobType,
      status,
      totalFetched: fetched.items.length,
      processed,
      cursorLookupCode: completed ? null : lastCursor,
      nextAllowedAt: nextAllowedAt?.toISOString() ?? null,
    };

    if (processed > 0 && result.created === 0 && result.updated === 0 && result.errors.length === processed) {
      throw new Error(`${jobType}: ${processed} attempts, 0 successes`);
    }

    await db.update(contactSyncState)
      .set({
        status,
        cursorLookupCode: completed ? null : lastCursor,
        lastCompletedAt: completed ? new Date() : existingState?.lastCompletedAt ?? null,
        nextAllowedAt,
        totalFetched: fetched.items.length,
        lastResult: response,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(contactSyncState.entityType, entityType));

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown sync contacts failure';
    await db.update(contactSyncState)
      .set({
        status: 'failed',
        lastError: message,
        nextAllowedAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(contactSyncState.entityType, entityType));
    throw err;
  }
}
