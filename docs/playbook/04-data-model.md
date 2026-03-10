# 04 — Data Model

## Design Principles

1. **Normalize the god table.** Legacy `pct_softpro_lookup_table` (one table for all people, 12 boolean flags) becomes `contacts` + `companies` + `contact_company_links`.
2. **Merge the three-table split.** Legacy `order_details` + `transaction_details` + `property_details` becomes `orders` + `order_properties` + `order_parties`.
3. **Direct FKs for the big three.** Orders always have sales_rep, title_officer, escrow_officer. These are direct FK columns on `orders` for fast querying. All other parties go through `order_parties`.
4. **Unified vendor references.** Legacy scattered vendor IDs across order columns (westcor_order_id, westcor_cpl_id, etc.). vNext uses `order_external_refs` key-value table.
5. **Unified CPL branches.** Legacy had 4 separate branch tables. vNext has one `cpl_branches` table with underwriter discriminator.
6. **Source tracking.** `contacts` and `companies` track `source_system` + `source_id` so we always know where a record came from.

## Complete Drizzle Schema

### File: `lib/db/schema/orders.ts`

```typescript
import {
  pgTable, pgEnum, serial, text, varchar, integer, decimal,
  timestamp, boolean, jsonb, uniqueIndex, index
} from 'drizzle-orm/pg-core';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const operationalStatusEnum = pgEnum('operational_status', [
  'open', 'in_process', 'completed', 'closed', 'canceled', 'duplicate',
]);

export const transactionTypeEnum = pgEnum('transaction_type', [
  'Purchase', 'Refinance', 'Equity', 'Other',
]);

export const orderSourceEnum = pgEnum('order_source', [
  'softpro_sync', 'manual_entry', 'web_form',
]);

export const statusChangeSourceEnum = pgEnum('status_change_source', [
  'softpro_sync', 'manual', 'system', 'webhook',
]);

export const partyRoleEnum = pgEnum('party_role', [
  'buyer', 'seller', 'buyer_agent', 'listing_agent',
  'lender', 'lender_contact', 'escrow_company', 'borrower', 'other',
]);

export const vendorSystemEnum = pgEnum('vendor_system', [
  'softpro', 'titlepoint', 'westcor', 'fnf', 'natic', 'doma', 'black_knight',
]);

// ─── Orders ──────────────────────────────────────────────────────────────────
// Merges legacy: order_details + transaction_details (minus revenue fields)

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  fileNumber: varchar('file_number', { length: 50 }).notNull(),
  branchId: integer('branch_id').references(() => branches.id),

  // Status
  operationalStatus: operationalStatusEnum('operational_status').notNull().default('open'),
  softproStatus: varchar('softpro_status', { length: 50 }),

  // Transaction metadata
  transactionType: transactionTypeEnum('transaction_type'),
  productType: varchar('product_type', { length: 100 }),
  orderType: varchar('order_type', { length: 100 }),
  source: orderSourceEnum('source').notNull().default('softpro_sync'),

  // Key assignments (direct FKs for the big three)
  salesRepId: integer('sales_rep_id').references(() => contacts.id),
  titleOfficerId: integer('title_officer_id').references(() => contacts.id),
  escrowOfficerId: integer('escrow_officer_id').references(() => contacts.id),

  // Key dates
  openedAt: timestamp('opened_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  closedAt: timestamp('closed_at'),

  // Financial (sync'd from SoftPro, not editable in Hub)
  salesPrice: decimal('sales_price', { precision: 12, scale: 2 }),
  loanAmount: decimal('loan_amount', { precision: 12, scale: 2 }),

  // Sync tracking
  softproLastSyncedAt: timestamp('softpro_last_synced_at'),
  isImported: boolean('is_imported').notNull().default(false),

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
// Legacy: property_details

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

  // CPL address overrides (legacy: cpl_proposed_property_*)
  cplAddress: varchar('cpl_address', { length: 500 }),
  cplCity: varchar('cpl_city', { length: 100 }),
  cplState: varchar('cpl_state', { length: 10 }),
  cplZip: varchar('cpl_zip', { length: 20 }),

  // Ownership (from SoftPro/Black Knight)
  primaryOwner: text('primary_owner'),
  secondaryOwner: text('secondary_owner'),
  borrowersVesting: text('borrowers_vesting'),
  fips: varchar('fips', { length: 20 }),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Order Parties ───────────────────────────────────────────────────────────
// For parties beyond the big three (sales rep, TO, EO which are direct FKs)

export const orderParties = pgTable('order_parties', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  role: partyRoleEnum('role').notNull(),
  contactId: integer('contact_id').references(() => contacts.id),

  // For external parties not in contacts table
  externalName: varchar('external_name', { length: 200 }),
  externalCompany: varchar('external_company', { length: 200 }),
  externalEmail: varchar('external_email', { length: 200 }),
  externalPhone: varchar('external_phone', { length: 50 }),

  isPrimary: boolean('is_primary').notNull().default(false),
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
}));

// ─── Order External References ───────────────────────────────────────────────
// Replaces legacy scattered vendor ID columns

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
```

### File: `lib/db/schema/contacts.ts`

```typescript
import {
  pgTable, pgEnum, serial, text, varchar, integer,
  timestamp, boolean, jsonb, index
} from 'drizzle-orm/pg-core';

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
// Extends Supabase Auth users with app-layer metadata

export const profileRoleEnum = pgEnum('profile_role', [
  'super_admin', 'admin', 'cs_admin',
  'sales_rep', 'title_officer', 'escrow_officer',
  'client',
]);

export const profiles = pgTable('profiles', {
  id: varchar('id', { length: 64 }).primaryKey(), // Supabase Auth user UUID
  displayName: varchar('display_name', { length: 200 }),
  email: varchar('email', { length: 200 }),
  role: profileRoleEnum('role').notNull().default('client'),
  branchId: integer('branch_id').references(() => branches.id),
  contactId: integer('contact_id').references(() => contacts.id), // Links to SoftPro-synced contact
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Contacts ────────────────────────────────────────────────────────────────
// Replaces: pct_softpro_lookup_table (the god table)
// One row per person/entity from SoftPro or manual creation

export const contactTypeEnum = pgEnum('contact_type', [
  'person', 'officer', 'company_contact',
]);

export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),

  // Source tracking
  sourceSystem: varchar('source_system', { length: 50 }).default('softpro'), // 'softpro' | 'manual'
  sourceId: varchar('source_id', { length: 100 }), // SoftPro lookup_code

  type: contactTypeEnum('type').notNull().default('person'),

  // Identity
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  fullName: varchar('full_name', { length: 200 }),
  companyName: varchar('company_name', { length: 200 }),
  officerName: varchar('officer_name', { length: 200 }), // Legacy: officer_name / closer_examiner

  // Contact info
  email: varchar('email', { length: 200 }),
  phone: varchar('phone', { length: 50 }),
  cell: varchar('cell', { length: 50 }),
  fax: varchar('fax', { length: 50 }),

  // Address
  address1: varchar('address1', { length: 200 }),
  address2: varchar('address2', { length: 200 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 10 }),
  zip: varchar('zip', { length: 20 }),

  // Role classification (replaces 12 boolean flags)
  // Array of roles: ['sales_rep', 'title_officer', 'lender', etc.]
  roles: jsonb('roles').$type<string[]>().notNull().default([]),

  // Lender-specific
  assignmentClause: text('assignment_clause'),
  licenseNo: varchar('license_no', { length: 50 }),

  // SoftPro sync metadata
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
  rolesIdx: index('contacts_roles_idx').on(table.roles),
}));

// ─── Companies ───────────────────────────────────────────────────────────────
// Replaces: sp_company

export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  sourceSystem: varchar('source_system', { length: 50 }).default('softpro'),
  sourceId: varchar('source_id', { length: 100 }),

  name: varchar('name', { length: 200 }).notNull(),
  companyType: varchar('company_type', { length: 100 }), // 'escrow_company', 'lender', 'title_company'
  lookupCode: varchar('lookup_code', { length: 100 }),

  address1: varchar('address1', { length: 200 }),
  address2: varchar('address2', { length: 200 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 10 }),
  zip: varchar('zip', { length: 20 }),
  phone: varchar('phone', { length: 50 }),
  fax: varchar('fax', { length: 50 }),
  email: varchar('email', { length: 200 }),

  // Lender-specific
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
  relationshipType: varchar('relationship_type', { length: 50 }), // 'employee', 'officer', 'rep'
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  contactCompanyIdx: index('ccl_contact_company_idx').on(table.contactId, table.companyId),
}));
```

### File: `lib/db/schema/documents.ts`

```typescript
import {
  pgTable, pgEnum, serial, text, varchar, integer, bigint,
  timestamp, boolean, jsonb, index
} from 'drizzle-orm/pg-core';

export const docCategoryEnum = pgEnum('doc_category', [
  'cpl', 'prelim', 'policy', 'legal_vesting', 'grant_deed',
  'tax', 'general', 'user_upload', 'proposed_insured', 'curative',
]);

export const docStatusEnum = pgEnum('doc_status', [
  'active', 'deleted', 'failed',
]);

export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  category: docCategoryEnum('category').notNull().default('general'),

  filename: varchar('filename', { length: 500 }).notNull(),
  originalFilename: varchar('original_filename', { length: 500 }),
  storageProvider: varchar('storage_provider', { length: 20 }).notNull().default('s3'), // 's3' | 'r2'
  storageKey: varchar('storage_key', { length: 500 }).notNull(),
  contentType: varchar('content_type', { length: 100 }).default('application/pdf'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  checksum: varchar('checksum', { length: 64 }),

  status: docStatusEnum('status').notNull().default('active'),
  description: text('description'),

  // SoftPro sync
  isSyncedToSoftpro: boolean('is_synced_to_softpro').notNull().default(false),
  softproSyncedAt: timestamp('softpro_synced_at'),
  softproSyncError: text('softpro_sync_error'),

  createdBy: varchar('created_by', { length: 64 }), // Profile ID
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  orderIdx: index('documents_order_id_idx').on(table.orderId),
  categoryIdx: index('documents_category_idx').on(table.category),
}));

// ─── Document Audit ──────────────────────────────────────────────────────────

export const docActionEnum = pgEnum('doc_action', [
  'uploaded', 'downloaded', 'viewed', 'deleted',
  'attached_to_softpro', 'attach_failed', 'generated',
]);

export const documentAudit = pgTable('document_audit', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  action: docActionEnum('action').notNull(),
  byUserId: varchar('by_user_id', { length: 64 }), // Profile ID
  meta: jsonb('meta'),
  performedAt: timestamp('performed_at').notNull().defaultNow(),
}, (table) => ({
  documentIdx: index('doc_audit_document_idx').on(table.documentId),
}));
```

### File: `lib/db/schema/integrations.ts`

```typescript
import {
  pgTable, pgEnum, serial, text, varchar, integer,
  timestamp, boolean, jsonb, index
} from 'drizzle-orm/pg-core';

// ─── Vendor API Logs ─────────────────────────────────────────────────────────

export const vendorApiLogs = pgTable('vendor_api_logs', {
  id: serial('id').primaryKey(),
  vendor: varchar('vendor', { length: 50 }).notNull(),
  operation: varchar('operation', { length: 100 }).notNull(),
  orderId: integer('order_id'),
  requestId: varchar('request_id', { length: 100 }),

  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  success: boolean('success'),
  retryable: boolean('retryable').notNull().default(false),
  httpStatus: integer('http_status'),
  errorCategory: varchar('error_category', { length: 50 }),

  requestMeta: jsonb('request_meta'),   // Sanitized request info
  responseMeta: jsonb('response_meta'), // Sanitized response info

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  vendorIdx: index('vendor_logs_vendor_idx').on(table.vendor),
  orderIdx: index('vendor_logs_order_idx').on(table.orderId),
  createdIdx: index('vendor_logs_created_idx').on(table.createdAt),
}));

// ─── CPL Branches (Unified) ─────────────────────────────────────────────────
// Replaces: pct_order_westcore_branches, pct_order_fnf_agents,
//           pct_order_natic_branches, pct_order_doma_branches

export const underwriterEnum = pgEnum('underwriter', [
  'westcor', 'fnf', 'natic', 'doma',
]);

export const cplBranches = pgTable('cpl_branches', {
  id: serial('id').primaryKey(),
  underwriter: underwriterEnum('underwriter').notNull(),
  branchCode: varchar('branch_code', { length: 100 }),
  branchName: varchar('branch_name', { length: 200 }),
  agencyName: varchar('agency_name', { length: 200 }),
  address: varchar('address', { length: 200 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 10 }).default('CA'),
  zip: varchar('zip', { length: 20 }),
  phone: varchar('phone', { length: 50 }),
  underwriterCode: varchar('underwriter_code', { length: 50 }),
  isProposedBranch: boolean('is_proposed_branch').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  underwriterCityIdx: index('cpl_branches_uw_city_idx').on(table.underwriter, table.city),
}));

// ─── Vendor Tokens (Unified Cache) ──────────────────────────────────────────

export const vendorTokens = pgTable('vendor_tokens', {
  id: serial('id').primaryKey(),
  vendor: varchar('vendor', { length: 50 }).notNull(),
  tokenType: varchar('token_type', { length: 50 }).notNull(),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── TitlePoint Data ─────────────────────────────────────────────────────────

export const titlePointData = pgTable('title_point_data', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull(),
  fileNumber: varchar('file_number', { length: 50 }).notNull(),
  requestId: varchar('request_id', { length: 100 }),
  serviceId: varchar('service_id', { length: 100 }),
  searchType: varchar('search_type', { length: 50 }), // 'geo', 'tax', 'lv'
  status: varchar('status', { length: 50 }),
  message: text('message'),
  fips: varchar('fips', { length: 20 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── CPL Error Logs ──────────────────────────────────────────────────────────

export const cplErrorLogs = pgTable('cpl_error_logs', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id'),
  fileNumber: varchar('file_number', { length: 50 }),
  underwriter: varchar('underwriter', { length: 50 }),
  error: text('error').notNull(),
  context: varchar('context', { length: 100 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

### File: `lib/db/schema/jobs.ts`

```typescript
import {
  pgTable, pgEnum, serial, text, varchar, integer,
  timestamp, jsonb, index
} from 'drizzle-orm/pg-core';

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

// ─── Event Outbox ────────────────────────────────────────────────────────────

export const eventOutbox = pgTable('event_outbox', {
  id: serial('id').primaryKey(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  orderId: integer('order_id'),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  publishedAt: timestamp('published_at'),
  failCount: integer('fail_count').notNull().default(0),
}, (table) => ({
  unpublishedIdx: index('outbox_unpublished_idx').on(table.publishedAt),
}));
```

### File: `lib/db/schema/admin.ts`

```typescript
import {
  pgTable, serial, text, varchar, integer,
  timestamp, jsonb, index
} from 'drizzle-orm/pg-core';

// ─── Admin Activity Logs ─────────────────────────────────────────────────────

export const adminActivityLogs = pgTable('admin_activity_logs', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 64 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }),
  entityId: varchar('entity_id', { length: 100 }),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  userIdx: index('admin_logs_user_idx').on(table.userId),
  createdIdx: index('admin_logs_created_idx').on(table.createdAt),
}));

// ─── Roles ───────────────────────────────────────────────────────────────────

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description'),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── Settings ────────────────────────────────────────────────────────────────

export const settings = pgTable('settings', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: jsonb('value'),
  description: text('description'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Notification Templates ──────────────────────────────────────────────────

export const notificationTemplates = pgTable('notification_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  subject: text('subject'),
  body: text('body'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

### File: `lib/db/schema/index.ts`

```typescript
// Barrel export — the single import point
export * from './orders';
export * from './contacts';
export * from './documents';
export * from './integrations';
export * from './jobs';
export * from './admin';
```

## Seed Data

### Branches
```typescript
const PCT_BRANCHES = [
  { code: 'GLT', name: 'Glendale', city: 'Glendale' },
  { code: 'OCT', name: 'Orange County', city: 'Orange' },
  { code: 'ONT', name: 'Ontario', city: 'Ontario' },
  { code: 'PRV', name: 'Oxnard', city: 'Oxnard' },
  { code: 'TSG', name: 'San Diego', city: 'San Diego' },
];
```

### Default Roles
```typescript
const DEFAULT_ROLES = [
  { name: 'super_admin', description: 'Full access', permissions: ['*'] },
  { name: 'admin', description: 'Standard admin', permissions: ['admin.*'] },
  { name: 'cs_admin', description: 'Customer service admin', permissions: ['admin.orders', 'admin.contacts', 'admin.documents'] },
  { name: 'sales_rep', description: 'Sales representative', permissions: ['orders.own', 'documents.view'] },
  { name: 'title_officer', description: 'Title officer', permissions: ['orders.own', 'documents.view', 'documents.upload'] },
  { name: 'escrow_officer', description: 'Escrow officer', permissions: ['orders.own', 'documents.view', 'documents.upload', 'vendor_actions.cpl'] },
  { name: 'client', description: 'External client', permissions: ['client.*'] },
];
```

## Legacy → vNext Table Mapping

| Legacy Table(s) | vNext Table | Notes |
|-----------------|-------------|-------|
| `order_details` + `transaction_details` | `orders` | Merged. Revenue fields excluded. |
| `property_details` | `order_properties` | 1:1 with orders |
| (scattered FK columns on order_details) | `order_parties` | buyer_agent, listing_agent, lender, etc. |
| (scattered westcor_*, fnf_* columns) | `order_external_refs` | Key-value by vendor system |
| `pct_softpro_lookup_table` (god table) | `contacts` | Roles as JSONB array instead of 12 boolean flags |
| `sp_company` | `companies` | Separate from contacts |
| (implicit) | `contact_company_links` | Explicit many-to-many |
| `pct_order_documents` | `documents` | Added storage_provider, checksum, sync tracking |
| (no audit table existed) | `document_audit` | New — every action logged |
| `pct_order_api_logs` + `pct_resware_log` | `vendor_api_logs` | Consolidated, sane naming |
| `pct_order_westcore_branches` + `pct_order_fnf_agents` + `pct_order_natic_branches` + `pct_order_doma_branches` | `cpl_branches` | Unified with underwriter discriminator |
| `pct_order_westcore_token` + `pct_order_fnf_token` | `vendor_tokens` | Unified token cache |
| `pct_order_title_point_data` | `title_point_data` | Simplified |
| `admin` table | `profiles` + Supabase Auth | Auth in Supabase, metadata in profiles |
| `pct_users_role` | `roles` | Added permissions JSONB |
| `pct_configs` | `settings` | Key-value config |
| (no event outbox existed) | `event_outbox` | New — decoupled side effects |

## Canon References
- `td-source-extraction.md` §7 — All Phinx migration files (20+ migrations)
- `softpro-route-extraction.md` §6 — Data mapping tables
- `legacy-admin-extraction.md` §1 — Model inventory
- `lean_transaction_desk_hub_plan.md` §8
