import {
  pgTable, serial, text, varchar, integer,
  timestamp, boolean, jsonb, index,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { documents } from './documents';

export const prelimAnalyses = pgTable('prelim_analyses', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').references(() => orders.id),
  documentId: integer('document_id').references(() => documents.id),
  fileNumber: varchar('file_number', { length: 100 }).notNull(),

  status: varchar('status', { length: 50 }).notNull().default('pending'),
  triggeredBy: varchar('triggered_by', { length: 20 }).notNull(),

  pdfText: text('pdf_text'),
  pdfCharCount: integer('pdf_char_count'),

  factsJson: jsonb('facts_json'),
  extractionJson: jsonb('extraction_json'),
  summaryText: text('summary_text'),

  complexityScore: integer('complexity_score'),
  complexityLevel: varchar('complexity_level', { length: 20 }),
  complexityReasons: text('complexity_reasons').array(),

  requirementCount: integer('requirement_count').default(0),
  blockerCount: integer('blocker_count').default(0),
  lienCount: integer('lien_count').default(0),
  taxCount: integer('tax_count').default(0),
  taxDefaultCount: integer('tax_default_count').default(0),
  otherFindingCount: integer('other_finding_count').default(0),
  foreclosureDetected: boolean('foreclosure_detected').notNull().default(false),

  extractionModel: varchar('extraction_model', { length: 100 }),
  summaryModel: varchar('summary_model', { length: 100 }),

  errorMessage: text('error_message'),
  errorStep: varchar('error_step', { length: 50 }),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  orderIdx: index('prelim_analyses_order_idx').on(table.orderId),
  documentIdx: index('prelim_analyses_document_idx').on(table.documentId),
  statusIdx: index('prelim_analyses_status_idx').on(table.status),
}));
