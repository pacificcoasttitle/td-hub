import {
  pgTable, serial, varchar, text, integer, timestamp, jsonb, index, char,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { orders, partyRoleEnum } from './orders';

// ─── Party Collection Wizard ─────────────────────────────────────────────────
//
// Applied by hand via docs/migration-party-wizard.sql. Keep the two in step.
//
// SoftPro's updateOrder cannot reliably attach parties: the create path writes
// the wrong name and drops the company, and the update path returns 200 while
// changing nothing (verified on staging 2026-08-18). So v1 collects into TD Hub
// and posts a structured note. Every submission is kept REPLAYABLE so the gap
// can be backfilled into SoftPro once the adapter fix ships.

/**
 * A tokenized, revocable link handed to an external party.
 *
 * DB-backed rather than a stateless HMAC because these links write data: we need
 * revocation, a used_at, and a per-token rate limit that survives a serverless
 * cold start. The HMAC still gates the request; the row gates everything else.
 */
export const partyWizardLinks = pgTable('party_wizard_links', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  role: partyRoleEnum('role').notNull(),

  /** Public opaque id, appears in the URL. Safe to log. */
  tokenId: varchar('token_id', { length: 32 }).notNull().unique(),
  /** SHA-256 of the token secret. The secret itself is never stored. */
  tokenHash: char('token_hash', { length: 64 }).notNull(),

  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),

  firstAccessedAt: timestamp('first_accessed_at'),
  lastAccessedAt: timestamp('last_accessed_at'),
  accessCount: integer('access_count').notNull().default(0),

  /** First successful submission. A milestone, not a lock — resume stays open. */
  usedAt: timestamp('used_at'),
  submissionCount: integer('submission_count').notNull().default(0),
  lastSubmittedAt: timestamp('last_submitted_at'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 100 }),
}, (table) => ({
  orderRoleIdx: index('party_wizard_links_order_role_idx').on(table.orderId, table.role),
  expiresIdx: index('party_wizard_links_expires_idx').on(table.expiresAt),
}));

/**
 * One submission event. Never updated in place by a later submission — a
 * correction is a new row, so the trail survives.
 *
 * The discrete party columns exist so a replay can build a SoftPro CreateUser
 * payload from the row alone rather than parsing submittedValues.
 */
export const partySubmissions = pgTable('party_submissions', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  role: partyRoleEnum('role').notNull(),

  sourceLinkId: integer('source_link_id').references(() => partyWizardLinks.id, { onDelete: 'set null' }),
  tokenId: varchar('token_id', { length: 32 }),

  /** Who filled the form in. Provenance, not payload — see submittedEmail. */
  submitterEmail: varchar('submitter_email', { length: 200 }),

  /** The party itself. What a replay writes into SoftPro. */
  submittedName: varchar('submitted_name', { length: 200 }),
  submittedCompany: varchar('submitted_company', { length: 200 }),
  submittedEmail: varchar('submitted_email', { length: 200 }),
  submittedPhone: varchar('submitted_phone', { length: 50 }),

  /** Complete validated payload; superset of the columns above. */
  submittedValues: jsonb('submitted_values').notNull(),

  submittedAt: timestamp('submitted_at').notNull().defaultNow(),

  // v1 write path — the structured note. AddNotes works on both deployed builds.
  softproNoteStatus: varchar('softpro_note_status', { length: 20 }).notNull().default('pending'),
  softproNoteId: varchar('softpro_note_id', { length: 100 }),
  softproNoteError: text('softpro_note_error'),
  softproNoteAt: timestamp('softpro_note_at'),

  // Deferred write path — the real party attach, replayed once it works.
  // Everything lands on 'pending'. Nothing in v1 sets 'attached'.
  softproPartyStatus: varchar('softpro_party_status', { length: 20 }).notNull().default('pending'),
  softproPartyError: text('softpro_party_error'),
  softproPartyAt: timestamp('softpro_party_at'),
  softproPartyAttempts: integer('softpro_party_attempts').notNull().default(0),
  /** Stored back after a two-step write so a retry cannot mint a duplicate. */
  softproClientLookupCode: varchar('softpro_client_lookup_code', { length: 50 }),
  softproCompanyLookupCode: varchar('softpro_company_lookup_code', { length: 50 }),
}, (table) => ({
  orderRoleIdx: index('party_submissions_order_role_idx').on(table.orderId, table.role, table.submittedAt),
  linkIdx: index('party_submissions_link_idx').on(table.sourceLinkId),
}));

export const partyWizardLinksRelations = relations(partyWizardLinks, ({ one, many }) => ({
  order: one(orders, { fields: [partyWizardLinks.orderId], references: [orders.id] }),
  submissions: many(partySubmissions),
}));

export const partySubmissionsRelations = relations(partySubmissions, ({ one }) => ({
  order: one(orders, { fields: [partySubmissions.orderId], references: [orders.id] }),
  link: one(partyWizardLinks, { fields: [partySubmissions.sourceLinkId], references: [partyWizardLinks.id] }),
}));

/** Note write-back states. */
export const PARTY_NOTE_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export type PartyNoteStatus = (typeof PARTY_NOTE_STATUSES)[number];

/** Replay-queue states for the deferred SoftPro party attach. */
export const PARTY_ATTACH_STATUSES = ['pending', 'attached', 'failed', 'skipped', 'superseded'] as const;
export type PartyAttachStatus = (typeof PARTY_ATTACH_STATUSES)[number];

/** order_parties.source — provenance of the row that created it. */
export const PARTY_SOURCES = ['softpro_sync', 'party_wizard', 'manual'] as const;
export type PartySource = (typeof PARTY_SOURCES)[number];
