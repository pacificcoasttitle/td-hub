/**
 * READ-ONLY. Reconstructs who the prelim auto-deliveries went to.
 *
 * The auto-delivery path logs document_id, outcome and message_id but NOT the
 * recipient, so the addressee cannot be read back from the record. This re-runs
 * the same resolver the send used. It is deterministic given unchanged contact
 * data, so it is a faithful reconstruction rather than a guess — but it is a
 * reconstruction, and if a contact's email changed since the send it will differ.
 *
 * Writes nothing.
 */
import { db } from '../../src/lib/db/client';
import { sql } from 'drizzle-orm';
import { resolvePrelimRecipients } from '../../src/lib/domain/notifications/prelim-recipient-resolution';

/** Orders created by the 2026-08-27 recovery. */
const RECOVERY_CUTOFF = '2026-08-27 05:20:00';

async function main() {
  const rows = await db.execute(sql`
    select
      l.created_at        as sent_at,
      l.entity_id::int    as order_id,
      o.file_number,
      o.opened_at::date   as opened,
      o.operational_status,
      l.meta->>'message_id' as message_id
    from admin_activity_logs l
    join orders o on o.id = l.entity_id::int
    where l.action = 'prelim_auto_delivery'
      and l.meta->>'outcome' = 'delivered'
      and o.created_at >= ${RECOVERY_CUTOFF}
    order by l.created_at
  `) as unknown as Array<{
    sent_at: string; order_id: number; file_number: string;
    opened: string; operational_status: string; message_id: string | null;
  }>;

  console.log(`${rows.length} delivered prelim emails traced to recovered orders\n`);

  const recipientTally = new Map<string, number>();

  for (const r of rows) {
    const resolved = await resolvePrelimRecipients(r.order_id).catch(() => null);

    const toEmail = resolved?.to?.email ?? '(unresolved)';
    const to = resolved?.to ? `${resolved.to.email}${resolved.to.name ? ` (${resolved.to.name})` : ''}` : '(unresolved)';
    const cc = (resolved?.cc ?? [])
      .map((c) => `${c.email}${c.source ? ` [${c.source}]` : ''}`)
      .join(', ');
    recipientTally.set(toEmail, (recipientTally.get(toEmail) ?? 0) + 1);

    console.log(`${r.file_number}  opened=${r.opened}  ${r.operational_status}`);
    console.log(`  sent_at : ${r.sent_at}`);
    console.log(`  to      : ${to}`);
    if (cc) console.log(`  cc      : ${cc}`);
    console.log('');
  }

  console.log('--- distinct recipients ---');
  for (const [email, n] of [...recipientTally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(3)}  ${email}`);
  }
  console.log(`\ndistinct recipients: ${recipientTally.size}, emails: ${rows.length}`);
}

main().then(
  () => process.exit(0),
  (err) => { console.error('FAILED:', err); process.exit(1); },
);
