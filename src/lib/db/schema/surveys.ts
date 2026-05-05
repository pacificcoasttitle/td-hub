import {
  pgTable, uuid, text, integer, boolean, timestamp,
  uniqueIndex, index, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orders } from './orders';
import { contacts, companies, profiles } from './contacts';

// ─── Surveys ─────────────────────────────────────────────────────────────────
// One row per send attempt that succeeded. Token is the recipient's credential.
// (orderId, recipientType) is unique → guarantees we never double-send.

export const surveys = pgTable('surveys', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id),
  recipientType: text('recipient_type', { enum: ['lender', 'escrow_officer'] }).notNull(),
  recipientEmail: text('recipient_email').notNull(),
  recipientName: text('recipient_name'),
  recipientContactId: integer('recipient_contact_id').references(() => contacts.id),
  recipientCompanyId: integer('recipient_company_id').references(() => companies.id),
  token: text('token').notNull(),
  status: text('status', {
    enum: ['sent', 'completed', 'expired', 'bounced'],
  }).notNull().default('sent'),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  bouncedAt: timestamp('bounced_at', { withTimezone: true }),
  bounceReason: text('bounce_reason'),
  sendgridMessageId: text('sendgrid_message_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tokenIdx: uniqueIndex('surveys_token_idx').on(table.token),
  orderRecipientIdx: uniqueIndex('surveys_order_recipient_idx').on(table.orderId, table.recipientType),
  statusIdx: index('surveys_status_idx').on(table.status),
  sentAtIdx: index('surveys_sent_at_idx').on(table.sentAt),
}));

// ─── Survey Responses ────────────────────────────────────────────────────────
// One row per completed response. surveyId unique → DB-level guarantee of single response.
// CHECK constraint enforces 1–5 rating range so bad data can't sneak in via a route bug.

export const surveyResponses = pgTable('survey_responses', {
  id: uuid('id').defaultRandom().primaryKey(),
  surveyId: uuid('survey_id').notNull().references(() => surveys.id),
  communicationRating: integer('communication_rating').notNull(),
  timelinessRating: integer('timeliness_rating').notNull(),
  overallRating: integer('overall_rating').notNull(),
  comment: text('comment'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
}, (table) => ({
  surveyIdIdx: uniqueIndex('survey_responses_survey_idx').on(table.surveyId),
  ratingCheck: check(
    'survey_responses_rating_check',
    sql`${table.communicationRating} BETWEEN 1 AND 5
        AND ${table.timelinessRating} BETWEEN 1 AND 5
        AND ${table.overallRating} BETWEEN 1 AND 5`,
  ),
}));

// ─── Survey Send Log ─────────────────────────────────────────────────────────
// Every send attempt — including skips and failures — for Ops dashboard surfacing.
// cronRunId groups all attempts from a single cron execution → easy debugging.

export const surveySendLog = pgTable('survey_send_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: integer('order_id').references(() => orders.id),
  recipientType: text('recipient_type', { enum: ['lender', 'escrow_officer'] }),
  result: text('result', {
    enum: [
      'sent',
      'skipped_globally_disabled',
      'skipped_client_opted_out',
      'skipped_no_email',
      'skipped_already_sent',
      'failed',
    ],
  }).notNull(),
  errorMessage: text('error_message'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  cronRunId: uuid('cron_run_id'),
}, (table) => ({
  orderIdx: index('survey_send_log_order_idx').on(table.orderId),
  resultIdx: index('survey_send_log_result_idx').on(table.result),
  attemptedAtIdx: index('survey_send_log_attempted_at_idx').on(table.attemptedAt),
}));

// ─── Survey Opt-Out Audit ────────────────────────────────────────────────────
// Compliance trail for company-level opt-out toggles.
// changedBy is varchar(64) (not uuid) to match profiles.id, which stores the
// Supabase Auth UUID as a string — the spec's `uuid` type would type-mismatch.

export const surveyOptoutAudit = pgTable('survey_optout_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: integer('company_id').notNull().references(() => companies.id),
  previousValue: boolean('previous_value').notNull(),
  newValue: boolean('new_value').notNull(),
  reason: text('reason'),
  changedBy: text('changed_by').notNull().references(() => profiles.id),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyIdx: index('survey_optout_audit_company_idx').on(table.companyId),
}));
