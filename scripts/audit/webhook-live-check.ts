import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
(async () => {
  console.log('─── 1. Are rows landing in email_events? ───────────────────');
  const [c] = await sql`SELECT count(*) n, min(received_at) first, max(received_at) latest, max(occurred_at) latest_event FROM email_events`;
  console.log(`rows: ${c!.n}   first received: ${c!.first}   most recent: ${c!.latest}`);
  if (Number(c!.n) > 0) {
    console.log('\nby event type:');
    for (const r of await sql`SELECT event, count(*) n, max(occurred_at) latest FROM email_events GROUP BY 1 ORDER BY 2 DESC`) {
      console.log(`  ${String(r.event).padEnd(14)} ${String(r.n).padStart(5)}   latest ${r.latest}`);
    }
  }

  console.log('\n─── 2. Matching: ours vs the other system ──────────────────');
  const batches = await sql`
    SELECT created_at, success, error_category, response_meta
    FROM vendor_api_logs
    WHERE vendor='sendgrid' AND operation LIKE 'sendgrid_events%'
    ORDER BY created_at DESC LIMIT 200`;
  console.log(`webhook batches logged: ${batches.length}`);
  const tot = { received: 0, kept: 0, unmatched: 0, duplicates: 0, unusable: 0, updated: 0 };
  let rejected = 0;
  for (const b of batches) {
    const m = (b.response_meta ?? {}) as Record<string, number>;
    if (b.success === false) { rejected++; continue; }
    for (const k of Object.keys(tot)) tot[k as keyof typeof tot] += Number(m[k] ?? 0);
  }
  console.log('totals across those batches:', tot);
  if (tot.received > 0) {
    console.log(`  ours:        ${tot.kept + tot.duplicates} of ${tot.received}  (${(((tot.kept + tot.duplicates) / tot.received) * 100).toFixed(1)}%)`);
    console.log(`  not ours:    ${tot.unmatched}  (${((tot.unmatched / tot.received) * 100).toFixed(1)}% — the other system on this account)`);
  }

  console.log('\n─── 3. Did signature verification actually run? ────────────');
  console.log(`batches REFUSED (401): ${rejected}`);
  for (const r of await sql`
    SELECT error_category, count(*) n, max(created_at) latest FROM vendor_api_logs
    WHERE vendor='sendgrid' AND operation='sendgrid_events_rejected' GROUP BY 1 ORDER BY 2 DESC`) {
    console.log(`  ${String(r.error_category).padEnd(28)} ${r.n}   latest ${r.latest}`);
  }

  console.log('\n─── 4. Does a real send show its outcome? ──────────────────');
  for (const r of await sql`SELECT status, count(*) n FROM notification_logs GROUP BY 1 ORDER BY 2 DESC`) {
    console.log(`  notification_logs  ${String(r.status).padEnd(12)} ${r.n}`);
  }
  console.log('');
  for (const r of await sql`
    SELECT n.created_at, n.status, n.recipient_email, n.event_type, left(coalesce(n.error_message,''), 70) AS detail
    FROM notification_logs n
    WHERE n.status <> 'sent'
    ORDER BY n.created_at DESC LIMIT 12`) {
    console.log(`  ${r.created_at.toISOString().slice(0,16)}  ${String(r.status).padEnd(10)} ${String(r.recipient_email).padEnd(34)} ${r.event_type}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }
  const [rd] = await sql`SELECT count(*) n, count(*) FILTER (WHERE outcome <> 'sent') settled FROM report_deliveries`;
  console.log(`\n  report_deliveries: ${rd!.n} rows, ${rd!.settled} settled beyond 'sent'`);
  await sql.end();
})();
