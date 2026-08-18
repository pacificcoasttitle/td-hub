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

  openedAt: timestamp('opened_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  closedAt: timestamp('closed_at'),

  salesPrice: decimal('sales_price', { precision: 12, scale: 2 }),
  loanAmount: decimal('loan_amount', { precision: 12, scale: 2 }),

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
   * does NOT protect the value: both writers merge per field, so a non-empty
   * SoftPro value still wins field by field. party_submissions is the record.
   */
  source: varchar('source', { length: 20 }),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  orderRoleIdx: index('order_parties_order_role_idx').on(table.orderId, table.role),
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
