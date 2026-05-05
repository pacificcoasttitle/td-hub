import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { contacts, companies, profiles } from './contacts';

// ─── Surveys ─────────────────────────────────────────────────────────────────

export const surveys = pgTable('surveys', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id),
  recipientType: varchar('recipient_type', { length: 20 }).notNull(),
  recipientEmail: varchar('recipient_email', { length: 200 }).notNull(),
  recipientName: varchar('recipient_name', { length: 200 }),
  recipientContactId: integer('recipient_contact_id').references(() => contacts.id),
  recipientCompanyId: integer('recipient_company_id').references(() => companies.id),
  token: varchar('token', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('sent'),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  completedAt: timestamp('completed_at'),
  bouncedAt: timestamp('bounced_at'),
  bounceReason: text('bounce_reason'),
  sendgridMessageId: varchar('sendgrid_message_id', { length: 200 }),
  notificationLogId: integer('notification_log_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  tokenIdx: uniqueIndex('surveys_token_idx').on(table.token),
  orderRecipientIdx: uniqueIndex('surveys_order_recipient_idx').on(table.orderId, table.recipientType),
  statusIdx: index('surveys_status_idx').on(table.status),
  sentAtIdx: index('surveys_sent_at_idx').on(table.sentAt),
}));

// ─── Survey Responses ────────────────────────────────────────────────────────

export const surveyResponses = pgTable('survey_responses', {
  id: serial('id').primaryKey(),
  surveyId: integer('survey_id').notNull().unique().references(() => surveys.id),
  communicationRating: integer('communication_rating').notNull(),
  timelinessRating: integer('timeliness_rating').notNull(),
  overallRating: integer('overall_rating').notNull(),
  comment: text('comment'),
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 50 }),
  userAgent: text('user_agent'),
});
// NOTE: CHECK constraint (1-5 rating range) lives in the SQL migration.
// Drizzle TypeScript schema does not represent CHECK constraints; the DB enforces them.

// ─── Survey Send Log ─────────────────────────────────────────────────────────

export const surveySendLog = pgTable('survey_send_log', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').references(() => orders.id),
  recipientType: varchar('recipient_type', { length: 20 }),
  result: varchar('result', { length: 40 }).notNull(),
  errorMessage: text('error_message'),
  attemptedAt: timestamp('attempted_at').notNull().defaultNow(),
  cronRunId: varchar('cron_run_id', { length: 64 }),
}, (table) => ({
  orderIdx: index('survey_send_log_order_idx').on(table.orderId),
  resultIdx: index('survey_send_log_result_idx').on(table.result),
  attemptedAtIdx: index('survey_send_log_attempted_at_idx').on(table.attemptedAt),
}));

// ─── Survey Opt-out Audit ────────────────────────────────────────────────────

export const surveyOptoutAudit = pgTable('survey_optout_audit', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull().references(() => companies.id),
  previousValue: boolean('previous_value').notNull(),
  newValue: boolean('new_value').notNull(),
  reason: text('reason'),
  changedBy: varchar('changed_by', { length: 64 }).notNull().references(() => profiles.id),
  changedAt: timestamp('changed_at').notNull().defaultNow(),
}, (table) => ({
  companyIdx: index('survey_optout_audit_company_idx').on(table.companyId),
}));
