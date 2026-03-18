// ============================================================
// Director-approved schema addition — 2026-03-17
// Add to: lib/db/schema/orders.ts (inside the orders table definition)
// ============================================================
//
// These three columns support the Admin Console overhaul:
//
// 1. dup_override — admin checkbox that allows duplicate APN orders
// 2. email_status — tracks order confirmation email delivery
// 3. created_by   — which hub user created the order (null for SoftPro synced)
//
// Add these lines inside the `orders` table definition in the Drizzle schema:

// --- PASTE INSIDE orders TABLE DEFINITION ---

dupOverride: boolean('dup_override').notNull().default(false),
emailStatus: varchar('email_status', { length: 20 }).notNull().default('pending'),
createdBy: uuid('created_by').references(() => profiles.id),

// --- END PASTE ---

// Then run the migration SQL in migration-dup-override.sql against Supabase.
//
// After migration, verify with:
//   SELECT column_name, data_type, column_default 
//   FROM information_schema.columns 
//   WHERE table_name = 'orders' 
//   AND column_name IN ('dup_override', 'email_status', 'created_by');
