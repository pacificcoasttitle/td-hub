import { pgTable, serial, varchar, text, integer, timestamp, date, jsonb, index } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';

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
/**
 * 0060 narrowed this to sent|failed because acceptance was all we could prove.
 * 0061 widens it, on evidence: the event webhook reports what the receiving
 * server did, so 'delivered' is earned rather than assumed.
 *
 * 'deferred' is deliberately absent. It means SendGrid is still retrying —
 * a step, not an outcome — and showing it would alarm somebody about the
 * normal case.
 */
export const REPORT_DELIVERY_OUTCOMES = [
  'sent', 'failed', 'delivered', 'bounced', 'dropped', 'spam',
] as const;
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
  /**
   * sent | failed | delivered | bounced | dropped | spam (migration 0061).
   *
   * 'sent' is the honest state between SendGrid accepting the message and the
   * first event about it — usually seconds. The four beyond it are written by
   * the event webhook and by nothing else: they are what the receiving server
   * did, not what we hoped.
   */
  outcome: varchar('outcome', { length: 20 }).notNull(),
  /** The provider's reason, verbatim. Required when the outcome is failed. */
  outcomeDetail: text('outcome_detail'),
  /**
   * SendGrid's message id, in its own column so an event can find this row
   * (migration 0061). It was written into outcomeDetail as prose first, which
   * could neither be indexed nor joined.
   */
  providerMessageId: varchar('provider_message_id', { length: 200 }),
  payloadMode: varchar('payload_mode', { length: 20 }).notNull(),
  /** signed_link only, so a link in an old email can be shown to have died. */
  linkExpiresAt: timestamp('link_expires_at'),
}, (t) => ({
  reportIdx: index('report_deliveries_report_idx').on(t.reportType, t.reportId, t.attemptedAt),
  attemptedIdx: index('report_deliveries_attempted_idx').on(t.attemptedAt),
}));

// ─── The three farming reports (migration 0057) ─────────────────────────────
//
// Three tables, not one: the list page prints Subject and Settings per row and
// those differ per type. The dataset is stored as the uploaded file; the report
// is stored as the COMPUTED FIGURES, so a re-render costs nothing and cannot
// drift from the database. Rejected rows are counted against the value that
// caused them — legacy dropped `Condo` and `SFR` in silence.

/** Columns every farming report carries. Repeated per table, deliberately. */
const brandedTo = {
  brandedToContactId: integer('branded_to_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  brandedToName: varchar('branded_to_name', { length: 200 }).notNull(),
  brandedToTitle: varchar('branded_to_title', { length: 120 }),
  brandedToEmail: varchar('branded_to_email', { length: 200 }),
  brandedToPhone: varchar('branded_to_phone', { length: 50 }),
  brandedToPhotoKey: varchar('branded_to_photo_key', { length: 500 }),
};

const dataset = {
  datasetSource: varchar('dataset_source', { length: 20 }).notNull().default('csv_upload'),
  datasetStorageKey: varchar('dataset_storage_key', { length: 500 }),
  datasetSha256: varchar('dataset_sha256', { length: 64 }),
  datasetRows: integer('dataset_rows').notNull().default(0),
  datasetUsed: integer('dataset_used').notNull().default(0),
  datasetRejected: integer('dataset_rejected').notNull().default(0),
  /** {"Mineral Rights": 4, "(blank type)": 2} — reported, never discarded. */
  rejectedTypes: jsonb('rejected_types'),
};

/**
 * Subject and Settings as the list prints them, stored at creation and rewritten
 * whenever the document is regenerated (migration 0058). Stored rather than
 * derived so the union is the same columns from every table — and so the row
 * says what the document says, the way template_version ties a PDF to its
 * template. Nullable: a row exists before its document does.
 */
const listing = {
  listSubject: varchar('list_subject', { length: 300 }),
  listSubjectDetail: varchar('list_subject_detail', { length: 300 }),
  listSettings: varchar('list_settings', { length: 300 }),
};

const artifact = {
  templateVersion: varchar('template_version', { length: 20 }).notNull(),
  pdfStorageKey: varchar('pdf_storage_key', { length: 500 }),
  pdfSha256: varchar('pdf_sha256', { length: 64 }),
  pdfBytes: integer('pdf_bytes'),
  pdfPageCount: integer('pdf_page_count'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 100 }),
};

export const salesActivityReports = pgTable('sales_activity_reports', {
  id: serial('id').primaryKey(),
  areaName: varchar('area_name', { length: 200 }).notNull(),
  propertyType: varchar('property_type', { length: 40 }),
  windowMonths: integer('window_months').notNull(),
  /** A real date range. Legacy matched the month NUMBER and mixed three Augusts. */
  windowStart: date('window_start').notNull(),
  windowEnd: date('window_end').notNull(),
  ...brandedTo,
  ...dataset,
  ...listing,
  metrics: jsonb('metrics'),
  months: jsonb('months'),
  ...artifact,
}, (t) => ({
  createdIdx: index('sales_activity_created_idx').on(t.createdAt),
  brandedIdx: index('sales_activity_branded_idx').on(t.brandedToContactId),
}));

export const carrierRouteReports = pgTable('carrier_route_reports', {
  id: serial('id').primaryKey(),
  areaName: varchar('area_name', { length: 200 }).notNull(),
  rankBy: varchar('rank_by', { length: 30 }).notNull(),
  ...brandedTo,
  ...dataset,
  /** Each standout computed from its OWN field; legacy's non-owner tile was not. */
  ...listing,
  standouts: jsonb('standouts'),
  routes: jsonb('routes'),
  ...artifact,
}, (t) => ({
  createdIdx: index('carrier_route_created_idx').on(t.createdAt),
  brandedIdx: index('carrier_route_branded_idx').on(t.brandedToContactId),
}));

export const countySalesReports = pgTable('county_sales_reports', {
  id: serial('id').primaryKey(),
  county: varchar('county', { length: 60 }).notNull(),
  /** The first of the month, as a date. Not a month number. */
  month: date('month').notNull(),
  ...brandedTo,
  ...dataset,
  ...listing,
  cities: jsonb('cities'),
  /** From the per-sale rows: a median of city medians is not a median. */
  totals: jsonb('totals'),
  ...artifact,
}, (t) => ({
  createdIdx: index('county_sales_created_idx').on(t.createdAt),
  brandedIdx: index('county_sales_branded_idx').on(t.brandedToContactId),
}));
