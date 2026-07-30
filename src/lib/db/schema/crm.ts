import {
  pgTable, serial, text, varchar, integer, timestamp, index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { contacts, profiles } from './contacts';

// ─── CRM Clients ─────────────────────────────────────────────────────────────
// A sales rep's personal client record. Independent of SoftPro: sync jobs
// never read or write this table. `contactId` is an optional, rep-confirmed
// pointer to a synced contact, used read-only to display order history.

export const crmClients = pgTable('crm_clients', {
  id: serial('id').primaryKey(),
  ownerProfileId: varchar('owner_profile_id', { length: 64 })
    .notNull()
    .references(() => profiles.id),
  name: varchar('name', { length: 200 }).notNull(),
  company: varchar('company', { length: 200 }),
  email: varchar('email', { length: 200 }),
  phone: varchar('phone', { length: 50 }),
  /**
   * Business-source classification: agent | lender | escrow | title | other.
   * Nullable — unclassified is a valid state. Plain varchar with a DB CHECK
   * rather than a pg enum, so drizzle-kit generate/journal stays untouched;
   * the app validates with a Zod union (CRM_CLIENT_TYPES).
   */
  type: varchar('type', { length: 20 }),
  contactId: integer('contact_id').references(() => contacts.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  ownerIdx: index('crm_clients_owner_idx').on(table.ownerProfileId),
  ownerEmailIdx: index('crm_clients_owner_email_idx').on(table.ownerProfileId, table.email),
  contactIdx: index('crm_clients_contact_idx').on(table.contactId),
}));

// ─── CRM Client Notes ────────────────────────────────────────────────────────

export const crmClientNotes = pgTable('crm_client_notes', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id')
    .notNull()
    .references(() => crmClients.id, { onDelete: 'cascade' }),
  authorProfileId: varchar('author_profile_id', { length: 64 })
    .notNull()
    .references(() => profiles.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  clientIdx: index('crm_client_notes_client_idx').on(table.clientId),
}));

// ─── Relations ───────────────────────────────────────────────────────────────

export const crmClientsRelations = relations(crmClients, ({ one, many }) => ({
  owner: one(profiles, { fields: [crmClients.ownerProfileId], references: [profiles.id] }),
  contact: one(contacts, { fields: [crmClients.contactId], references: [contacts.id] }),
  notes: many(crmClientNotes),
}));

export const crmClientNotesRelations = relations(crmClientNotes, ({ one }) => ({
  client: one(crmClients, { fields: [crmClientNotes.clientId], references: [crmClients.id] }),
  author: one(profiles, { fields: [crmClientNotes.authorProfileId], references: [profiles.id] }),
}));
