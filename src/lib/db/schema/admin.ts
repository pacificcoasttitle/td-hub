import {
  pgTable, serial, text, varchar, integer,
  timestamp, boolean, jsonb, index,
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
