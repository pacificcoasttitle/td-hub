/**
 * Apply 0061 inside a transaction, prove it, then ROLL BACK.
 *
 * Nothing is left behind. The point is to find out whether the migration runs
 * against the real production schema — and what the backfill actually matches
 * — before it is applied for keeps.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const migration = readFileSync('src/lib/db/migrations/0061_sendgrid_event_webhook.sql', 'utf8');

(async () => {
  const before = await sql`
    SELECT count(*) AS rows,
           count(*) FILTER (WHERE outcome_detail LIKE '%message %') AS with_message_prose
    FROM report_deliveries`;
  console.log('report_deliveries before:', before[0]);

  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(migration);

      const constraint = await tx`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'report_deliveries_outcome_check'`;
      console.log('\nconstraint now:', constraint[0]?.def);

      const cols = await tx`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'email_events' ORDER BY ordinal_position`;
      console.log('email_events:', cols.map((c) => `${c.column_name} ${c.data_type}`).join(', '));

      const backfilled = await tx`
        SELECT count(*) AS n FROM report_deliveries WHERE provider_message_id IS NOT NULL`;
      console.log('rows whose message id was recovered from the prose:', backfilled[0]!.n);

      // The constraint must now ACCEPT what the webhook writes...
      for (const outcome of ['delivered', 'bounced', 'dropped', 'spam']) {
        await tx`
          INSERT INTO report_deliveries (report_type, report_id, recipient_email, outcome, payload_mode)
          VALUES ('county_sales', 999999, 'probe@pct.com', ${outcome}, 'attachment')`;
      }
      console.log('accepts: delivered, bounced, dropped, spam');

      // ...and still REFUSE what it should.
      // A SAVEPOINT, because an expected failure still aborts the whole
      // transaction in Postgres — without it every later probe fails with the
      // first probe's error and the script reports nonsense.
      let refused = false;
      try {
        await tx.savepoint(async (sp) => {
          await sp`
            INSERT INTO report_deliveries (report_type, report_id, recipient_email, outcome, payload_mode)
            VALUES ('county_sales', 999999, 'probe@pct.com', 'deferred', 'attachment')`;
        });
      } catch { refused = true; }
      console.log(refused ? 'refuses: deferred (a retry is not an outcome)' : 'PROBLEM: deferred was accepted');

      // The idempotency index must actually stop a duplicate event.
      const when = new Date();
      await tx`INSERT INTO email_events (sg_message_id, event, email, occurred_at, raw)
               VALUES ('probe', 'bounce', 'a@b.com', ${when}, '{}'::jsonb)`;
      let dupRefused = false;
      try {
        await tx.savepoint(async (sp) => {
          await sp`INSERT INTO email_events (sg_message_id, event, email, occurred_at, raw)
                   VALUES ('probe', 'bounce', 'a@b.com', ${when}, '{}'::jsonb)`;
        });
      } catch { dupRefused = true; }
      console.log(dupRefused ? 'refuses: the same event twice' : 'PROBLEM: a retried event would double-count');

      throw new Error('ROLLBACK — verification only');
    });
  } catch (e) {
    const msg = String(e);
    if (!msg.includes('ROLLBACK — verification only')) { console.error('\nFAILED:', msg); process.exit(1); }
    console.log('\nRolled back. Nothing was changed.');
  }

  const after = await sql`
    SELECT to_regclass('public.email_events') AS email_events,
           (SELECT count(*) FROM information_schema.columns
             WHERE table_name='report_deliveries' AND column_name='provider_message_id') AS new_col`;
  console.log('after rollback — email_events:', after[0]!.email_events, ' provider_message_id columns:', after[0]!.new_col);

  await sql.end();
})();
