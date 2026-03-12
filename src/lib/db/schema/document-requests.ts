import {
  pgTable, pgEnum, serial, text, varchar, integer,
  timestamp, index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { orders } from './orders';
import { documents } from './documents';

export const docRequestStatusEnum = pgEnum('doc_request_status', [
  'pending', 'fulfilled', 'canceled',
]);

export const documentRequests = pgTable('document_requests', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  requestedBy: varchar('requested_by', { length: 64 }).notNull(),
  requestType: varchar('request_type', { length: 100 }).notNull(),
  message: text('message'),
  status: docRequestStatusEnum('status').notNull().default('pending'),
  fulfilledDocumentId: integer('fulfilled_document_id').references(() => documents.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  orderIdx: index('doc_requests_order_idx').on(table.orderId),
  statusIdx: index('doc_requests_status_idx').on(table.status),
  requestedByIdx: index('doc_requests_user_idx').on(table.requestedBy),
}));

export const documentRequestsRelations = relations(documentRequests, ({ one }) => ({
  order: one(orders, { fields: [documentRequests.orderId], references: [orders.id] }),
  fulfilledDocument: one(documents, { fields: [documentRequests.fulfilledDocumentId], references: [documents.id] }),
}));
