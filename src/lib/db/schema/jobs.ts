import {
  pgTable, pgEnum, serial, text, varchar, integer,
  timestamp, jsonb, index,
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
  cursorLookupCode: varchar('cursor_lookup_code', { length: 200 }),
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
