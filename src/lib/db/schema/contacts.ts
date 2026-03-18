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
  'open_order_team',
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

  lookupCode: varchar('lookup_code', { length: 100 }),
  flookupCode: varchar('flookup_code', { length: 100 }),

  courtesyTitle: varchar('courtesy_title', { length: 50 }),
  firstName: varchar('first_name', { length: 100 }),
  middleName: varchar('middle_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  fullName: varchar('full_name', { length: 200 }),
  suffix: varchar('suffix', { length: 50 }),
  title: varchar('title', { length: 100 }),

  companyName: varchar('company_name', { length: 200 }),
  officerName: varchar('officer_name', { length: 200 }),
  closerExaminer: varchar('closer_examiner', { length: 200 }),
  officeLookupCode: varchar('office_lookup_code', { length: 100 }),

  email: varchar('email', { length: 200 }),
  phone: varchar('phone', { length: 50 }),
  phoneExt: varchar('phone_ext', { length: 20 }),
  cell: varchar('cell', { length: 50 }),
  fax: varchar('fax', { length: 50 }),
  pager: varchar('pager', { length: 50 }),

  genderId: varchar('gender_id', { length: 10 }),

  address1: varchar('address1', { length: 200 }),
  address2: varchar('address2', { length: 200 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 10 }),
  zip: varchar('zip', { length: 20 }),

  note: text('note'),

  roles: jsonb('roles').$type<string[]>().notNull().default([]),

  assignmentClause: text('assignment_clause'),
  licenseNo: varchar('license_no', { length: 50 }),

  softproLookupCode: varchar('softpro_lookup_code', { length: 100 }),
  softproFlookupCode: varchar('softpro_flookup_code', { length: 100 }),
  softproUserType: varchar('softpro_user_type', { length: 100 }),

  userType: varchar('user_type', { length: 50 }),

  isEscrow: boolean('is_escrow').notNull().default(false),
  isEscrowOfficer: boolean('is_escrow_officer').notNull().default(false),
  isLender: boolean('is_lender').notNull().default(false),
  isMortgageBroker: boolean('is_mortgage_broker').notNull().default(false),
  isSellingAgent: boolean('is_selling_agent').notNull().default(false),
  isTitleOfficer: boolean('is_title_officer').notNull().default(false),
  isSalesRep: boolean('is_sales_rep').notNull().default(false),
  isNewUser: boolean('is_new_user').notNull().default(false),
  isMailNotification: boolean('is_mail_notification').notNull().default(false),

  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  lookupCodeIdx: index('contacts_lookup_code_idx').on(table.softproLookupCode),
  lookupCodeNewIdx: index('contacts_lookup_code_new_idx').on(table.lookupCode),
  flookupCodeIdx: index('contacts_flookup_code_idx').on(table.flookupCode),
  closerExaminerIdx: index('contacts_closer_examiner_idx').on(table.closerExaminer),
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

  payeeName: varchar('payee_name', { length: 200 }),
  address1: varchar('address1', { length: 200 }),
  address2: varchar('address2', { length: 200 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 10 }),
  zip: varchar('zip', { length: 20 }),
  phone: varchar('phone', { length: 50 }),
  fax: varchar('fax', { length: 50 }),
  email: varchar('email', { length: 200 }),

  assignmentClause: text('assignment_clause'),
  signatureLine: text('signature_line'),
  feeTransferLedger: varchar('fee_transfer_ledger', { length: 200 }),
  stateOfIncorporation: varchar('state_of_incorporation', { length: 100 }),
  marketingRep: varchar('marketing_rep', { length: 200 }),
  specialInstructions: text('special_instructions'),
  legalName: varchar('legal_name', { length: 200 }),

  fundingAddress1: varchar('funding_address1', { length: 200 }),
  fundingAddress2: varchar('funding_address2', { length: 200 }),
  fundingCity: varchar('funding_city', { length: 100 }),
  fundingState: varchar('funding_state', { length: 10 }),
  fundingZip: varchar('funding_zip', { length: 20 }),
  fundingPhone: varchar('funding_phone', { length: 50 }),
  fundingFax: varchar('funding_fax', { length: 50 }),

  homePhone: varchar('home_phone', { length: 50 }),
  represents: varchar('represents', { length: 200 }),
  licenseNo: varchar('license_no', { length: 50 }),

  branchId: integer('branch_id').references(() => branches.id),
  salesRepId: integer('sales_rep_id').references(() => contacts.id),
  titleOfficerId: integer('title_officer_id').references(() => contacts.id),
  loanUnderwriter: varchar('loan_underwriter', { length: 200 }),
  salesUnderwriter: varchar('sales_underwriter', { length: 200 }),

  isEscrowCompany: boolean('is_escrow_company').notNull().default(false),
  isLender: boolean('is_lender').notNull().default(false),
  isMortgageBroker: boolean('is_mortgage_broker').notNull().default(false),
  isSellingAgent: boolean('is_selling_agent').notNull().default(false),
  isUnderwriter: boolean('is_underwriter').notNull().default(false),

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
