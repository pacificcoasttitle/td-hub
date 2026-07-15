import {
  pgTable, pgEnum, serial, text, varchar, integer, bigint,
  timestamp, boolean, jsonb, index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { orders } from './orders';

// ─── Documents ───────────────────────────────────────────────────────────────

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
  storageProvider: varchar('storage_provider', { length: 20 }).notNull().default('s3'),
  storageKey: varchar('storage_key', { length: 500 }).notNull(),
  contentType: varchar('content_type', { length: 100 }).default('application/pdf'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  checksum: varchar('checksum', { length: 64 }),

  status: docStatusEnum('status').notNull().default('active'),
  description: text('description'),

  isSyncedToSoftpro: boolean('is_synced_to_softpro').notNull().default(false),
  softproSyncedAt: timestamp('softpro_synced_at'),
  softproSyncError: text('softpro_sync_error'),

  createdBy: varchar('created_by', { length: 64 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  orderIdx: index('documents_order_id_idx').on(table.orderId),
  categoryIdx: index('documents_category_idx').on(table.category),
}));

// ─── Document Audit ──────────────────────────────────────────────────────────

export const docActionEnum = pgEnum('doc_action', [
  'uploaded', 'downloaded', 'viewed', 'deleted',
  'attached_to_softpro', 'attach_failed', 'generated', 'delivered',
]);

export const documentAudit = pgTable('document_audit', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  action: docActionEnum('action').notNull(),
  byUserId: varchar('by_user_id', { length: 64 }),
  meta: jsonb('meta'),
  performedAt: timestamp('performed_at').notNull().defaultNow(),
}, (table) => ({
  documentIdx: index('doc_audit_document_idx').on(table.documentId),
  performedAtIdx: index('doc_audit_performed_at_idx').on(table.performedAt),
}));

// ─── Relations ───────────────────────────────────────────────────────────────

export const documentsRelations = relations(documents, ({ one, many }) => ({
  order: one(orders, { fields: [documents.orderId], references: [orders.id] }),
  auditTrail: many(documentAudit),
}));

export const documentAuditRelations = relations(documentAudit, ({ one }) => ({
  document: one(documents, { fields: [documentAudit.documentId], references: [documents.id] }),
}));
