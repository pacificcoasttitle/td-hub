import {
  pgTable, pgEnum, serial, text, varchar, integer,
  timestamp, boolean, jsonb, index,
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

  requestMeta: jsonb('request_meta'),
  responseMeta: jsonb('response_meta'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  vendorIdx: index('vendor_logs_vendor_idx').on(table.vendor),
  orderIdx: index('vendor_logs_order_idx').on(table.orderId),
  createdIdx: index('vendor_logs_created_idx').on(table.createdAt),
}));

// ─── CPL Branches (Unified) ─────────────────────────────────────────────────

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

// ─── Vendor Tokens ───────────────────────────────────────────────────────────

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
  orderId: integer('order_id'),
  fileNumber: varchar('file_number', { length: 50 }),
  sessionId: varchar('session_id', { length: 100 }),
  requestId: varchar('request_id', { length: 100 }),
  serviceId: varchar('service_id', { length: 100 }),
  searchType: varchar('search_type', { length: 50 }),
  status: varchar('status', { length: 50 }),
  message: text('message'),
  fips: varchar('fips', { length: 20 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  orderIdx: index('title_point_data_order_idx').on(table.orderId),
  sessionIdx: index('title_point_data_session_idx').on(table.sessionId),
  createdAtIdx: index('title_point_data_created_at_idx').on(table.createdAt),
}));

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
