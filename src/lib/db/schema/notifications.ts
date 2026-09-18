import {
  pgTable, serial, varchar, text, boolean, integer, timestamp, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orders } from './orders';

export const notificationTypes = pgTable('notification_types', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description'),
  channels: text('channels').array().notNull().default(['{email}']),
  isEnabled: boolean('is_enabled').notNull().default(true),
  recipientRoles: text('recipient_roles').array(),
  internalCc: text('internal_cc').array(),
  templateId: varchar('template_id', { length: 100 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  slugIdx: index('notification_types_slug_idx').on(table.slug),
}));

export const notificationLogs = pgTable('notification_logs', {
  id: serial('id').primaryKey(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  orderId: integer('order_id').references(() => orders.id),
  channel: varchar('channel', { length: 20 }).notNull(),
  recipientEmail: varchar('recipient_email', { length: 255 }),
  recipientPhone: varchar('recipient_phone', { length: 50 }),
  recipientName: varchar('recipient_name', { length: 255 }),
  recipientRole: varchar('recipient_role', { length: 100 }),
  subject: varchar('subject', { length: 500 }),
  templateUsed: varchar('template_used', { length: 100 }),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  provider: varchar('provider', { length: 50 }),
  providerId: varchar('provider_id', { length: 255 }),
  errorMessage: text('error_message'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  sentAt: timestamp('sent_at'),
}, (table) => ({
  orderIdx: index('notification_logs_order_idx').on(table.orderId),
  typeIdx: index('notification_logs_type_idx').on(table.eventType),
  statusIdx: index('notification_logs_status_idx').on(table.status),
}));

/**
 * Where SoftPro and the hub disagree about an order's contact (migration 0052).
 *
 * Written by the pre-send refresh today (source 'pre_send') and by the weekly
 * sweep when it ships (source 'sweep'). One OPEN row per (order, role, field):
 * a difference seen again updates last_seen_at and times_seen; a later read that
 * agrees closes it as 'converged'. A differs send writes SoftPro onto this
 * order's party and closes as 'applied_softpro'. History stays; the open row
 * does not. See pre-send-refresh.
 */
export const orderContactDrift = pgTable('order_contact_drift', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 40 }).notNull(),
  field: varchar('field', { length: 40 }).notNull().default('email'),
  /** differs | softpro_has_none */
  kind: varchar('kind', { length: 40 }).notNull(),
  /** pre_send | sweep */
  source: varchar('source', { length: 20 }).notNull(),
  /** prelim | lender_policy | owner_policy | supplement — null for the sweep */
  sendKind: varchar('send_kind', { length: 40 }),
  ours: text('ours'),
  softpro: text('softpro'),
  firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  timesSeen: integer('times_seen').notNull().default(1),
  resolvedAt: timestamp('resolved_at'),
  resolution: varchar('resolution', { length: 40 }),
}, (table) => ({
  openUniq: uniqueIndex('order_contact_drift_open_uniq')
    .on(table.orderId, table.role, table.field)
    .where(sql`resolved_at IS NULL`),
  lastSeenIdx: index('order_contact_drift_last_seen_idx').on(table.lastSeenAt),
}));
