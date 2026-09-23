/**
 * Apply 0061 to production, for keeps, and prove it landed.
 *
 * Additive only: a new table, a nullable column, and a WIDER check constraint.
 * The code currently deployed is unaffected by all three, which is why this
 * goes first — applying it late would break Notify rep the moment the new
 * code lands.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const migration = readFileSync('src/lib/db/migrations/0061_sendgrid_event_webhook.sql', 'utf8');

(async () => {
  const already = await sql`SELECT to_regclass('public.email_events') AS t`;
  if (already[0]!.t) {
    console.log('email_events already exists — 0061 looks applied. Stopping rather than guessing.');
    await sql.end();
    return;
  }

  console.log('Applying 0061…');
  await sql.unsafe(migration);
  console.log('Applied.\n');

  const [constraint] = await sql`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conname = 'report_deliveries_outcome_check'`;
  const [rls] = await sql`
    SELECT relrowsecurity FROM pg_class WHERE relname = 'email_events'`;
  const [col] = await sql`
    SELECT count(*) AS n FROM information_schema.columns
    WHERE table_name = 'report_deliveries' AND column_name = 'provider_message_id'`;
  const [idx] = await sql`
    SELECT count(*) AS n FROM pg_indexes WHERE indexname = 'email_events_once_idx'`;

  console.log('email_events RLS enabled:      ', rls?.relrowsecurity);
  console.log('provider_message_id column:    ', col!.n);
  console.log('idempotency index:             ', idx!.n);
  console.log('outcome constraint:            ', constraint?.def);

  await sql.end();
})().catch((e) => { console.error('FAILED:', String(e)); process.exit(1); });
