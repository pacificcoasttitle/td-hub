import {
  pgTable, pgEnum, serial, text, varchar, integer,
  timestamp, jsonb, index,
  boolean,
} from 'drizzle-orm/pg-core';

// ─── Jobs ────────────────────────────────────────────────────────────────────

export const jobStatusEnum = pgEnum('job_status', [
  'queued', 'running', 'completed', 'failed', 'retrying',
]);

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  jobType: varchar('job_type', { length: 100 }).notNull(),
  orderId: integer('order_id'),
  payload: jsonb('payload'),
  status: jobStatusEnum('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  error: text('error'),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  nextRetryAt: timestamp('next_retry_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  statusIdx: index('jobs_status_idx').on(table.status),
  typeIdx: index('jobs_type_idx').on(table.jobType),
  retryIdx: index('jobs_retry_idx').on(table.nextRetryAt),
}));

export const contactSyncState = pgTable('contact_sync_state', {
  entityType: varchar('entity_type', { length: 100 }).primaryKey(),
  jobType: varchar('job_type', { length: 100 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('idle'),
  /**
   * The last lookup code of the last completed page — the page boundary the
   * resumable sync compares the next page against. Null between sweeps.
   */
  cursorLookupCode: varchar('cursor_lookup_code', { length: 200 }),
  /** Resumable sync (migration 0050): the page the next run starts at. */
  nextPage: integer('next_page').notNull().default(1),
  /** Pagination.TotalPages as of the current sweep's latest page. */
  totalPages: integer('total_pages'),
  /** When the current sweep read its first page. Null between sweeps. */
  sweepStartedAt: timestamp('sweep_started_at'),
  /** Pagination.TotalRows when the current sweep began. */
  sweepTotalRows: integer('sweep_total_rows'),
  /** When a sweep last read every page. */
  lastSweepCompletedAt: timestamp('last_sweep_completed_at'),
  /**
   * TotalRows fell during the sweep: a deletion before the cursor shifts rows
   * left and one can be skipped until the next sweep. Recorded, not repaired.
   */
  driftSuspected: boolean('drift_suspected').notNull().default(false),
  lastSyncedAt: timestamp('last_synced_at'),
  lastStartedAt: timestamp('last_started_at'),
  lastCompletedAt: timestamp('last_completed_at'),
  nextAllowedAt: timestamp('next_allowed_at'),
  totalFetched: integer('total_fetched').notNull().default(0),
  lastResult: jsonb('last_result'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  jobTypeIdx: index('contact_sync_state_job_type_idx').on(table.jobType),
  nextAllowedIdx: index('contact_sync_state_next_allowed_idx').on(table.nextAllowedAt),
}));

// ─── Event Outbox ────────────────────────────────────────────────────────────

export const eventOutbox = pgTable('event_outbox', {
  id: serial('id').primaryKey(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  orderId: integer('order_id'),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  publishedAt: timestamp('published_at'),
  /** Set while a worker owns the row (FOR UPDATE SKIP LOCKED claim). Cleared on publish/fail. */
  claimedAt: timestamp('claimed_at'),
  failCount: integer('fail_count').notNull().default(0),
}, (table) => ({
  unpublishedIdx: index('outbox_unpublished_idx').on(table.publishedAt),
}));
