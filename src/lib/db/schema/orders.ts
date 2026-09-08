import {
  pgTable, pgEnum, serial, text, varchar, integer, decimal,
  timestamp, boolean, uniqueIndex, index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { branches, contacts, companies, profiles } from './contacts';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const operationalStatusEnum = pgEnum('operational_status', [
  'open', 'in_process', 'completed', 'closed', 'canceled', 'duplicate', 'hold',
]);

export const transactionTypeEnum = pgEnum('transaction_type', [
  'Purchase', 'Refinance', 'Equity', 'Other',
]);

export const orderSourceEnum = pgEnum('order_source', [
  'softpro_sync', 'manual_entry', 'web_form',
]);

export const statusChangeSourceEnum = pgEnum('status_change_source', [
  // 'lookback_sync' is applied to prod by hand — see
  // docs/migration-lookback-sync-enum.sql. The migration runner does not
  // reliably apply enum changes, so it must be confirmed present in the
  // database before code that writes it ships.
  'softpro_sync', 'manual', 'system', 'webhook', 'lookback_sync',
]);

export const partyRoleEnum = pgEnum('party_role', [
  'buyer', 'seller', 'buyer_agent', 'listing_agent',
  'lender', 'lender_contact', 'escrow_company', 'borrower', 'other',
]);

export const vendorSystemEnum = pgEnum('vendor_system', [
  'softpro', 'titlepoint', 'westcor', 'fnf', 'natic', 'doma', 'black_knight',
]);

// ─── Orders ──────────────────────────────────────────────────────────────────

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  fileNumber: varchar('file_number', { length: 50 }).notNull(),
  branchId: integer('branch_id').references(() => branches.id),

  operationalStatus: operationalStatusEnum('operational_status').notNull().default('open'),
  softproStatus: varchar('softpro_status', { length: 50 }),

  transactionType: transactionTypeEnum('transaction_type'),
  productType: varchar('product_type', { length: 100 }),
  orderType: varchar('order_type', { length: 100 }),
  source: orderSourceEnum('source').notNull().default('softpro_sync'),

  salesRepId: integer('sales_rep_id').references(() => contacts.id),
  titleOfficerId: integer('title_officer_id').references(() => contacts.id),
  escrowOfficerId: integer('escrow_officer_id').references(() => contacts.id),
  clientContactId: integer('client_contact_id').references(() => contacts.id),
  lenderId: integer('lender_id').references(() => contacts.id),
  listingAgentId: integer('listing_agent_id').references(() => contacts.id),
  titleCompanyId: integer('title_company_id').references(() => companies.id),
  underwriterId: integer('underwriter_id').references(() => companies.id),

  /**
   * When the order opened, per SoftPro's ReceivedDate. NULL when the vendor has
   * not told us.
   *
   * Deliberately nullable with no default. It used to be notNull().defaultNow(),
   * which meant every row the vendor gave no date for silently claimed to have
   * opened at the moment we happened to write it. That is not "unknown", it is a
   * false statement, and it propagated: it blinded the prelim backfill gate,
   * moved rows into the party wizard's 3-7 day eligibility window, and skewed
   * every latency figure measured from this column. 174 rows carried a
   * fabricated value before this changed. A null is honest and every reader can
   * see it.
   */
  openedAt: timestamp('opened_at'),
  completedAt: timestamp('completed_at'),
  closedAt: timestamp('closed_at'),

  salesPrice: decimal('sales_price', { precision: 12, scale: 2 }),
  loanAmount: decimal('loan_amount', { precision: 12, scale: 2 }),

  /**
   * Operator-entered at open and sent to SoftPro as LoanNumber / EscrowNumber.
   * Persisted here rather than read back, because the confirmation email is
   * queued from the create path and fires before any SoftPro sync runs.
   */
  loanNumber: varchar('loan_number', { length: 100 }),
  escrowNumber: varchar('escrow_number', { length: 100 }),

  marketingSource: varchar('marketing_source', { length: 200 }),
  softproLastSyncedAt: timestamp('softpro_last_synced_at'),
  lastPrelimFetchAt: timestamp('last_prelim_fetch_at'),
  lastDetailsFetchAt: timestamp('last_details_fetch_at'),
  detailsAttemptCount: integer('details_attempt_count').notNull().default(0),
  lastSitexFetchAt: timestamp('last_sitex_fetch_at'),
  sitexAttemptCount: integer('sitex_attempt_count').notNull().default(0),
  lastContactsFetchAt: timestamp('last_contacts_fetch_at'),
  contactsEmptyConfirmed: boolean('contacts_empty_confirmed').notNull().default(false),
  isImported: boolean('is_imported').notNull().default(false),

  dupOverride: boolean('dup_override').notNull().default(false),
  emailStatus: varchar('email_status', { length: 20 }).notNull().default('pending'),

  lenderPolicySent: boolean('lender_policy_sent').notNull().default(false),
  ownerPolicySent: boolean('owner_policy_sent').notNull().default(false),
  supplementStatementSent: boolean('supplement_statement_sent').notNull().default(false),
  recordingConfirmationSent: boolean('recording_confirmation_sent').notNull().default(false),

  createdBy: varchar('created_by', { length: 64 }).references(() => profiles.id),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  fileNumberIdx: uniqueIndex('orders_file_number_idx').on(table.fileNumber),
  branchIdx: index('orders_branch_id_idx').on(table.branchId),
  statusIdx: index('orders_status_idx').on(table.operationalStatus),
  openedAtIdx: index('orders_opened_at_idx').on(table.openedAt),
  salesRepIdx: index('orders_sales_rep_idx').on(table.salesRepId),
  titleOfficerIdx: index('orders_title_officer_idx').on(table.titleOfficerId),
}));

// ─── Order Properties ────────────────────────────────────────────────────────

export const orderProperties = pgTable('order_properties', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }).unique(),

  fullAddress: text('full_address'),
  address: varchar('address', { length: 500 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 10 }).default('CA'),
  zip: varchar('zip', { length: 20 }),
  county: varchar('county', { length: 100 }),
  apn: varchar('apn', { length: 50 }),
  /**
   * The unit, for a condo or any address with one.
   *
   * From SiteX `Location.UnitNumber`. Stored separately rather than folded into
   * `address` because the TitlePoint legal-vesting search needs it as its own
   * value — without it that search runs against the building and returns the
   * building's legal description.
   */
  unitNumber: varchar('unit_number', { length: 30 }),
  legalDescription: text('legal_description'),
  propertyType: varchar('property_type', { length: 50 }),

  cplAddress: varchar('cpl_address', { length: 500 }),
  cplCity: varchar('cpl_city', { length: 100 }),
  cplState: varchar('cpl_state', { length: 10 }),
  cplZip: varchar('cpl_zip', { length: 20 }),

  primaryOwner: text('primary_owner'),
  secondaryOwner: text('secondary_owner'),
  borrowersVesting: text('borrowers_vesting'),
  fips: varchar('fips', { length: 20 }),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Order Parties ───────────────────────────────────────────────────────────

export const orderParties = pgTable('order_parties', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  role: partyRoleEnum('role').notNull(),
  contactId: integer('contact_id').references(() => contacts.id),

  externalName: varchar('external_name', { length: 200 }),
  externalCompany: varchar('external_company', { length: 200 }),
  externalEmail: varchar('external_email', { length: 200 }),
  externalPhone: varchar('external_phone', { length: 50 }),

  isPrimary: boolean('is_primary').notNull().default(false),

  /**
   * Provenance of the row that created this party. NULL on everything that
   * predates the wizard, which is all existing rows. Records origin only — it
   * does NOT protect the value. The latch is party_confirmed_at.
   */
  source: varchar('source', { length: 20 }),

  /**
   * A named human confirmed the identity fields on this row. Parsers may fill
   * empty fields after this; they must not overwrite a populated confirmed
   * value. See protectConfirmedPartyFields.
   */
  partyConfirmedAt: timestamp('party_confirmed_at'),
  partyConfirmedSubmissionId: integer('party_confirmed_submission_id'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  orderRoleIdx: index('order_parties_order_role_idx').on(table.orderId, table.role),
  /**
   * (order_id, role, is_primary) is the party identity every writer already
   * uses: create-order, enrich-orders upsertResolvedParty, verify-order-sync
   * reconcileParties and the party wizard's projectToOrderParties all look a row
   * up by this exact triple before deciding to update or insert. Four code paths
   * agreeing by convention is what let create-order drift to the column default
   * and produce a second row per party; this makes the database the one that
   * holds them to it.
   *
   * Applied to production by hand as migration 0035 — see that file. Verified
   * against all 33,937 rows first: zero triples had more than one row, so no
   * cleanup was required.
   */
  orderRolePrimaryUnique: uniqueIndex('order_parties_order_role_primary_uniq')
    .on(table.orderId, table.role, table.isPrimary),
}));

// ─── Order Status History ────────────────────────────────────────────────────

export const orderStatusHistory = pgTable('order_status_history', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull(),
  source: statusChangeSourceEnum('source').notNull(),
  notes: text('notes'),
  changedAt: timestamp('changed_at').notNull().defaultNow(),
}, (table) => ({
  orderIdx: index('order_status_history_order_idx').on(table.orderId),
  changedAtIdx: index('order_status_history_changed_at_idx').on(table.changedAt),
}));

// ─── Order External References ───────────────────────────────────────────────

export const orderExternalRefs = pgTable('order_external_refs', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  system: vendorSystemEnum('system').notNull(),
  refType: varchar('ref_type', { length: 50 }).notNull(),
  refValue: varchar('ref_value', { length: 200 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  uniqueRef: uniqueIndex('external_refs_unique_idx').on(table.orderId, table.system, table.refType),
}));

// ─── Order Notes ─────────────────────────────────────────────────────────────

export const orderNotes = pgTable('order_notes', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  subject: varchar('subject', { length: 255 }),
  body: text('body').notNull(),
  authorName: varchar('author_name', { length: 255 }),
  authorId: varchar('author_id', { length: 64 }).references(() => profiles.id),
  /** When true, note is staff/SoftPro-internal and must not be returned by client APIs. */
  isInternal: boolean('is_internal').notNull().default(true),
  isSyncedToSoftpro: boolean('is_synced_to_softpro').notNull().default(false),
  softproNoteId: varchar('softpro_note_id', { length: 100 }),
  syncedAt: timestamp('synced_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  orderIdx: index('order_notes_order_idx').on(table.orderId),
  orderInternalIdx: index('order_notes_order_internal_idx').on(table.orderId, table.isInternal),
}));

// ─── Relations ───────────────────────────────────────────────────────────────

export const ordersRelations = relations(orders, ({ one, many }) => ({
  branch: one(branches, { fields: [orders.branchId], references: [branches.id] }),
  salesRep: one(contacts, { fields: [orders.salesRepId], references: [contacts.id], relationName: 'salesRep' }),
  titleOfficer: one(contacts, { fields: [orders.titleOfficerId], references: [contacts.id], relationName: 'titleOfficer' }),
  escrowOfficer: one(contacts, { fields: [orders.escrowOfficerId], references: [contacts.id], relationName: 'escrowOfficer' }),
  clientContact: one(contacts, { fields: [orders.clientContactId], references: [contacts.id], relationName: 'clientContact' }),
  lender: one(contacts, { fields: [orders.lenderId], references: [contacts.id], relationName: 'lender' }),
  listingAgent: one(contacts, { fields: [orders.listingAgentId], references: [contacts.id], relationName: 'listingAgent' }),
  titleCompany: one(companies, { fields: [orders.titleCompanyId], references: [companies.id], relationName: 'titleCompany' }),
  underwriter: one(companies, { fields: [orders.underwriterId], references: [companies.id], relationName: 'underwriter' }),
  property: one(orderProperties, { fields: [orders.id], references: [orderProperties.orderId] }),
  parties: many(orderParties),
  statusHistory: many(orderStatusHistory),
  externalRefs: many(orderExternalRefs),
  notes: many(orderNotes),
}));

export const orderPropertiesRelations = relations(orderProperties, ({ one }) => ({
  order: one(orders, { fields: [orderProperties.orderId], references: [orders.id] }),
}));

export const orderPartiesRelations = relations(orderParties, ({ one }) => ({
  order: one(orders, { fields: [orderParties.orderId], references: [orders.id] }),
  contact: one(contacts, { fields: [orderParties.contactId], references: [contacts.id] }),
}));

export const orderNotesRelations = relations(orderNotes, ({ one }) => ({
  order: one(orders, { fields: [orderNotes.orderId], references: [orders.id] }),
}));

// ─── Deliverable emails ──────────────────────────────────────────────────────
//
// Addresses the operator asks to be copied on documents for this order.
//
// A TABLE, NOT AN ARRAY COLUMN, because the approved decisions are "every
// document for the life of the order" and "editable after open" — which
// together want per-address provenance. An address that starts receiving a
// client's documents mid-transaction should be attributable to whoever added
// it. See docs/tickets/DELIVERABLE_EMAILS.md.
//
// Soft delete: removing an address must not erase that it was there.
// No unique index on (order_id, email): add/remove/re-add is legitimate
// history, and dedupe belongs at send time where TO and CC are reconciled.
export const orderDeliverableEmails = pgTable('order_deliverable_emails', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  /** Lowercased and trimmed by the application before it ever reaches here. */
  email: varchar('email', { length: 320 }).notNull(),
  addedBy: varchar('added_by', { length: 64 }),
  addedAt: timestamp('added_at').notNull().defaultNow(),
  removedBy: varchar('removed_by', { length: 64 }),
  removedAt: timestamp('removed_at'),
});
