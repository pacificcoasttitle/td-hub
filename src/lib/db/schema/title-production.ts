import {
  pgTable, serial, varchar, text, boolean, integer, timestamp, index,
} from 'drizzle-orm/pg-core';
import { profiles } from './contacts';

export const titleProductionUploads = pgTable('title_production_uploads', {
  id: serial('id').primaryKey(),
  orderNumber: varchar('order_number', { length: 100 }).notNull(),
  documentName: varchar('document_name', { length: 255 }).notNull(),
  filename: varchar('filename', { length: 500 }).notNull(),
  storageKey: varchar('storage_key', { length: 500 }).notNull(),
  publicUrl: text('public_url'),
  uploadedBy: varchar('uploaded_by', { length: 64 }).references(() => profiles.id),
  isSynced: boolean('is_synced').notNull().default(false),
  syncReason: text('sync_reason'),
  vendorLogId: integer('vendor_log_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  orderIdx: index('title_production_uploads_order_idx').on(table.orderNumber),
}));
