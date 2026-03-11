import {
  pgTable, pgEnum, serial, text, varchar, integer,
  timestamp, boolean, jsonb, index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Branches ────────────────────────────────────────────────────────────────

export const branches = pgTable('branches', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 10 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  address: text('address'),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 10 }).default('CA'),
  zip: varchar('zip', { length: 20 }),
  phone: varchar('phone', { length: 50 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── Profiles ────────────────────────────────────────────────────────────────

export const profileRoleEnum = pgEnum('profile_role', [
  'super_admin', 'admin', 'cs_admin',
  'sales_rep', 'title_officer', 'escrow_officer',
  'client',
]);

export const profiles = pgTable('profiles', {
  id: varchar('id', { length: 64 }).primaryKey(), // Supabase Auth UUID
  displayName: varchar('display_name', { length: 200 }),
  email: varchar('email', { length: 200 }),
  role: profileRoleEnum('role').notNull().default('client'),
  branchId: integer('branch_id').references(() => branches.id),
  contactId: integer('contact_id').references(() => contacts.id),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Contacts ────────────────────────────────────────────────────────────────

export const contactTypeEnum = pgEnum('contact_type', [
  'person', 'officer', 'company_contact',
]);

export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),

  sourceSystem: varchar('source_system', { length: 50 }).default('softpro'),
  sourceId: varchar('source_id', { length: 100 }),

  type: contactTypeEnum('type').notNull().default('person'),

  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  fullName: varchar('full_name', { length: 200 }),
  companyName: varchar('company_name', { length: 200 }),
  officerName: varchar('officer_name', { length: 200 }),

  email: varchar('email', { length: 200 }),
  phone: varchar('phone', { length: 50 }),
  cell: varchar('cell', { length: 50 }),
  fax: varchar('fax', { length: 50 }),

  address1: varchar('address1', { length: 200 }),
  address2: varchar('address2', { length: 200 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 10 }),
  zip: varchar('zip', { length: 20 }),

  roles: jsonb('roles').$type<string[]>().notNull().default([]),

  assignmentClause: text('assignment_clause'),
  licenseNo: varchar('license_no', { length: 50 }),

  softproLookupCode: varchar('softpro_lookup_code', { length: 100 }),
  softproFlookupCode: varchar('softpro_flookup_code', { length: 100 }),
  softproUserType: varchar('softpro_user_type', { length: 100 }),

  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  lookupCodeIdx: index('contacts_lookup_code_idx').on(table.softproLookupCode),
  emailIdx: index('contacts_email_idx').on(table.email),
  nameIdx: index('contacts_full_name_idx').on(table.fullName),
  rolesIdx: index('contacts_roles_idx').using('gin', table.roles),
}));

// ─── Companies ───────────────────────────────────────────────────────────────

export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  sourceSystem: varchar('source_system', { length: 50 }).default('softpro'),
  sourceId: varchar('source_id', { length: 100 }),

  name: varchar('name', { length: 200 }).notNull(),
  companyType: varchar('company_type', { length: 100 }),
  lookupCode: varchar('lookup_code', { length: 100 }),

  address1: varchar('address1', { length: 200 }),
  address2: varchar('address2', { length: 200 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 10 }),
  zip: varchar('zip', { length: 20 }),
  phone: varchar('phone', { length: 50 }),
  fax: varchar('fax', { length: 50 }),
  email: varchar('email', { length: 200 }),

  assignmentClause: text('assignment_clause'),
  payeeName: varchar('payee_name', { length: 200 }),
  signatureLine: text('signature_line'),
  feeTransferLedger: varchar('fee_transfer_ledger', { length: 200 }),

  branchId: integer('branch_id').references(() => branches.id),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  lookupCodeIdx: index('companies_lookup_code_idx').on(table.lookupCode),
  nameIdx: index('companies_name_idx').on(table.name),
}));

// ─── Contact ↔ Company Links ────────────────────────────────────────────────

export const contactCompanyLinks = pgTable('contact_company_links', {
  id: serial('id').primaryKey(),
  contactId: integer('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  companyId: integer('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  relationshipType: varchar('relationship_type', { length: 50 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  contactCompanyIdx: index('ccl_contact_company_idx').on(table.contactId, table.companyId),
}));

// ─── Relations ───────────────────────────────────────────────────────────────

export const profilesRelations = relations(profiles, ({ one }) => ({
  branch: one(branches, { fields: [profiles.branchId], references: [branches.id] }),
}));

export const contactCompanyLinksRelations = relations(contactCompanyLinks, ({ one }) => ({
  contact: one(contacts, { fields: [contactCompanyLinks.contactId], references: [contacts.id] }),
  company: one(companies, { fields: [contactCompanyLinks.companyId], references: [companies.id] }),
}));
