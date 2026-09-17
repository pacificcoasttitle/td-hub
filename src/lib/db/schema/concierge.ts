import {
  pgTable, serial, varchar, text, integer, bigint, boolean, timestamp, date,
  numeric, jsonb, char, index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { orders } from './orders';

// ─── Concierge Property Profile ──────────────────────────────────────────────
//
// Applied by hand via docs/migration-concierge-profile.sql. Keep the two in step.
//
// The legacy system stored a filename and nothing else, so no report could be
// reproduced or defended. Every column here answers one of: what did we ask for,
// what came back, what did we show, and what did the reader see.

export const conciergeProfiles = pgTable('concierge_profiles', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),

  requestedAddress: varchar('requested_address', { length: 500 }).notNull(),
  requestedCity: varchar('requested_city', { length: 100 }),
  requestedState: varchar('requested_state', { length: 10 }),
  requestedZip: varchar('requested_zip', { length: 20 }),

  sitexFeedId: varchar('sitex_feed_id', { length: 20 }).notNull(),
  /** The only per-call handle SiteX returns — how an invoice line maps to a report. */
  sitexSearchId: bigint('sitex_search_id', { mode: 'number' }),
  sitexRequestedAt: timestamp('sitex_requested_at'),
  sitexDurationMs: integer('sitex_duration_ms'),
  sitexCreditsCharged: integer('sitex_credits_charged').notNull().default(0),

  /** Guard evidence: generation is refused unless valid && !outside && count === 1. */
  isValidAddress: boolean('is_valid_address'),
  outsideCoverage: boolean('outside_coverage'),
  locationCount: integer('location_count'),
  matchMethodCode: varchar('match_method_code', { length: 10 }),

  rawStorageKey: varchar('raw_storage_key', { length: 500 }),
  rawSha256: char('raw_sha256', { length: 64 }),
  rawBytes: integer('raw_bytes'),

  platmapFilename: varchar('platmap_filename', { length: 200 }),
  platmapStatus: varchar('platmap_status', { length: 30 }),
  platmapStorageKey: varchar('platmap_storage_key', { length: 500 }),
  platmapSha256: char('platmap_sha256', { length: 64 }),

  /** text, not varchar: grows ~31 chars per plotted comp and we cannot bound the count. */
  compMapUrl: text('comp_map_url'),
  compMapStorageKey: varchar('comp_map_storage_key', { length: 500 }),
  compMapSha256: char('comp_map_sha256', { length: 64 }),

  subjectApn: varchar('subject_apn', { length: 50 }),
  subjectFips: varchar('subject_fips', { length: 10 }),
  subjectCounty: varchar('subject_county', { length: 100 }),
  subjectUseCode: varchar('subject_use_code', { length: 20 }),
  subjectUseDescription: varchar('subject_use_description', { length: 200 }),
  subjectBeds: integer('subject_beds'),
  subjectBaths: numeric('subject_baths', { precision: 4, scale: 1 }),
  subjectBuildingArea: integer('subject_building_area'),
  subjectLotSize: integer('subject_lot_size'),
  subjectYearBuilt: integer('subject_year_built'),
  subjectLatitude: numeric('subject_latitude', { precision: 10, scale: 6 }),
  subjectLongitude: numeric('subject_longitude', { precision: 10, scale: 6 }),

  /** Nullable on purpose: SaleLoanInfo came back empty on a real property. */
  subjectLastSaleDate: date('subject_last_sale_date'),
  subjectLastSalePrice: numeric('subject_last_sale_price', { precision: 12, scale: 2 }),

  taxYear: integer('tax_year'),
  taxAssessedValue: numeric('tax_assessed_value', { precision: 12, scale: 2 }),
  taxLandValue: numeric('tax_land_value', { precision: 12, scale: 2 }),
  taxImprovementValue: numeric('tax_improvement_value', { precision: 12, scale: 2 }),
  taxMarketValue: numeric('tax_market_value', { precision: 12, scale: 2 }),
  taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }),
  taxStatus: varchar('tax_status', { length: 50 }),

  /** What we ASKED FOR. The report prints these — never values derived from results. */
  criteriaSameUseCode: boolean('criteria_same_use_code').notNull(),
  criteriaLivingAreaPct: integer('criteria_living_area_pct'),
  criteriaBedDelta: integer('criteria_bed_delta'),
  criteriaBathDelta: integer('criteria_bath_delta'),
  criteriaRadiusMiles: numeric('criteria_radius_miles', { precision: 5, scale: 2 }),
  criteriaMonths: integer('criteria_months'),
  /** A TARGET, not a quota. comps_shown may legitimately be lower. */
  criteriaMaxComps: integer('criteria_max_comps').notNull(),
  criteriaExtra: jsonb('criteria_extra'),

  compsReturned: integer('comps_returned').notNull().default(0),
  compsQualified: integer('comps_qualified').notNull().default(0),
  compsShown: integer('comps_shown').notNull().default(0),

  metrics: jsonb('metrics'),

  preparedForName: varchar('prepared_for_name', { length: 200 }),
  preparedForEmail: varchar('prepared_for_email', { length: 200 }),
  preparedForCompany: varchar('prepared_for_company', { length: 200 }),
  presentingRepName: varchar('presenting_rep_name', { length: 200 }),
  presentingRepEmail: varchar('presenting_rep_email', { length: 200 }),
  presentingRepPhone: varchar('presenting_rep_phone', { length: 50 }),
  presentingRepTitle: varchar('presenting_rep_title', { length: 120 }),

  templateVersion: varchar('template_version', { length: 20 }).notNull(),
  pdfStorageKey: varchar('pdf_storage_key', { length: 500 }),
  pdfSha256: char('pdf_sha256', { length: 64 }),
  pdfBytes: integer('pdf_bytes'),
  pdfPageCount: integer('pdf_page_count'),

  status: varchar('status', { length: 20 }).notNull().default('pending'),
  errorMessage: text('error_message'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 100 }),
}, (t) => ({
  orderIdx: index('concierge_profiles_order_idx').on(t.orderId),
  createdIdx: index('concierge_profiles_created_idx').on(t.createdAt),
  apnIdx: index('concierge_profiles_apn_idx').on(t.subjectApn),
  searchIdx: index('concierge_profiles_searchid_idx').on(t.sitexSearchId),
}));

/**
 * The double-charge guard (migration 0055). One row per normalized requested
 * address; claimed before the SiteX call, released when nothing was spent.
 * See src/lib/domain/concierge/claim.ts.
 */
export const conciergeProfileClaims = pgTable('concierge_profile_claims', {
  requestKey: varchar('request_key', { length: 200 }).primaryKey(),
  profileId: integer('profile_id').references(() => conciergeProfiles.id, { onDelete: 'set null' }),
  /** Written after the call: the property the address turned out to be. */
  apn: varchar('apn', { length: 50 }),
  claimedAt: timestamp('claimed_at').notNull().defaultNow(),
}, (t) => ({
  claimedIdx: index('concierge_profile_claims_claimed_idx').on(t.claimedAt),
}));

export const conciergeProfileComps = pgTable('concierge_profile_comps', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id').notNull().references(() => conciergeProfiles.id, { onDelete: 'cascade' }),
  sourcePosition: integer('source_position').notNull(),

  selected: boolean('selected').notNull().default(false),
  /** NULL when selected; otherwise the rule that rejected it. */
  exclusionReason: varchar('exclusion_reason', { length: 40 }),
  displayPosition: integer('display_position'),

  address: varchar('address', { length: 500 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 10 }),
  zip: varchar('zip', { length: 20 }),
  apn: varchar('apn', { length: 50 }),

  salePrice: numeric('sale_price', { precision: 12, scale: 2 }),
  /** SiteX's own figure. Never recomputed from BuildingArea — that was the legacy bug. */
  pricePerSqft: numeric('price_per_sqft', { precision: 10, scale: 2 }),
  recordingDate: date('recording_date'),
  documentNumber: varchar('document_number', { length: 50 }),
  documentType: varchar('document_type', { length: 100 }),

  buildingArea: integer('building_area'),
  bedrooms: integer('bedrooms'),
  baths: numeric('baths', { precision: 4, scale: 1 }),
  yearBuilt: integer('year_built'),
  lotSize: integer('lot_size'),
  useDescription: varchar('use_description', { length: 200 }),

  proximityMiles: numeric('proximity_miles', { precision: 6, scale: 3 }),
  latitude: numeric('latitude', { precision: 10, scale: 6 }),
  longitude: numeric('longitude', { precision: 10, scale: 6 }),

  raw: jsonb('raw').notNull(),
}, (t) => ({
  profileIdx: index('concierge_comps_profile_idx').on(t.profileId, t.sourcePosition),
}));

export const conciergeProfileTransfers = pgTable('concierge_profile_transfers', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id').notNull().references(() => conciergeProfiles.id, { onDelete: 'cascade' }),
  sourcePosition: integer('source_position').notNull(),

  transactionType: varchar('transaction_type', { length: 60 }),
  documentType: varchar('document_type', { length: 100 }),
  recordingDate: date('recording_date'),
  contractDate: date('contract_date'),
  documentNumber: varchar('document_number', { length: 50 }),
  bookNumber: varchar('book_number', { length: 30 }),
  pageNumber: varchar('page_number', { length: 30 }),
  currentOwnerFlag: boolean('current_owner_flag'),
  isForeclosure: boolean('is_foreclosure'),

  raw: jsonb('raw').notNull(),
}, (t) => ({
  profileIdx: index('concierge_transfers_profile_idx').on(t.profileId, t.recordingDate),
}));

export const conciergeProfilesRelations = relations(conciergeProfiles, ({ one, many }) => ({
  order: one(orders, { fields: [conciergeProfiles.orderId], references: [orders.id] }),
  comps: many(conciergeProfileComps),
  transfers: many(conciergeProfileTransfers),
}));

export const CONCIERGE_STATUSES = ['pending', 'retrieved', 'generated', 'failed'] as const;
export type ConciergeStatus = (typeof CONCIERGE_STATUSES)[number];
