import { pgTable, serial, varchar, text, integer, timestamp, index } from 'drizzle-orm/pg-core';

// ─── Report deliveries ───────────────────────────────────────────────────────
//
// One row per ATTEMPT, written in the same transaction as the attempt, failures
// included (migration 0056). If the log write fails, the send fails.
//
// The prelim path has the opposite rule — logging never blocks a send — and it
// recorded 1 delivery out of 1,083. The Delivery column on the reports list
// reads this table, and there is deliberately no `sent` boolean anywhere: a flag
// and a log disagree eventually, and then neither is trusted.

/** notify_rep is telling the branded rep a report exists. It is not a send to an outside agent. */
export const REPORT_DELIVERY_KINDS = ['notify_rep', 'send_to_agent'] as const;
export const REPORT_DELIVERY_OUTCOMES = ['delivered', 'failed'] as const;
/** No permanent public link: an attachment, or a link that expires. */
export const REPORT_DELIVERY_PAYLOAD_MODES = ['attachment', 'signed_link'] as const;

export const reportDeliveries = pgTable('report_deliveries', {
  id: serial('id').primaryKey(),
  /** The four report types live in four tables, so this pair is the reference. */
  reportType: varchar('report_type', { length: 40 }).notNull(),
  reportId: integer('report_id').notNull(),
  kind: varchar('kind', { length: 20 }).notNull().default('notify_rep'),
  recipientName: varchar('recipient_name', { length: 200 }),
  recipientEmail: varchar('recipient_email', { length: 200 }).notNull(),
  sentBy: varchar('sent_by', { length: 100 }),
  /** Of the attempt, not of the success. */
  attemptedAt: timestamp('attempted_at').notNull().defaultNow(),
  outcome: varchar('outcome', { length: 20 }).notNull(),
  /** The provider's reason, verbatim. Required when the outcome is failed. */
  outcomeDetail: text('outcome_detail'),
  payloadMode: varchar('payload_mode', { length: 20 }).notNull(),
  /** signed_link only, so a link in an old email can be shown to have died. */
  linkExpiresAt: timestamp('link_expires_at'),
}, (t) => ({
  reportIdx: index('report_deliveries_report_idx').on(t.reportType, t.reportId, t.attemptedAt),
  attemptedIdx: index('report_deliveries_attempted_idx').on(t.attemptedAt),
}));
