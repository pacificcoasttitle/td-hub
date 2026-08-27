/**
 * READ-ONLY. The live surfaces that read orders.escrow_officer_id, evaluated
 * against BOTH rows of each duplicated officer.
 *
 * The preference is only worth shipping if some observable answer improves.
 * This runs the actual queries those surfaces run — /api/escrow/officers, the
 * prelim primary-recipient rule, the confirmation escrow CC — against contact
 * 12/14/15/16 and against 8996/10642/10999/17165, and prints both answers.
 *
 *   npx tsx --env-file=.env.local scripts/audit/eo-prefer-downstream.ts
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

type Row = Record<string, unknown>;

/** prelim-recipient-resolution.isValidEmail, copied. */
function isValidEmail(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  return t.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

(async () => {
  const [{ now }] = await sql.unsafe(`select now() at time zone 'utc' as now`) as unknown as Row[];
  console.log(`run (db utc): ${now}`);

  // ── /api/escrow/officers, exactly as the route builds it ──────────────────
  // where is_escrow_officer = true AND internalContactFilter()
  console.log('\n=== /api/escrow/officers TODAY (the escrow-assistant officer rail) ===');
  const railToday = await sql.unsafe(`
    select c.id,
           coalesce(nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''),
                    c.full_name, c.officer_name) as name,
           c.email,
           (select count(*)::int from orders o
             where o.escrow_officer_id = c.id
               and o.operational_status in ('open','in_process')) as active_count
      from contacts c
     where c.is_escrow_officer = true
       and (c.email ilike '%@pct.com' or exists (select 1 from profiles p where p.contact_id = c.id))
     order by 2
  `) as unknown as Row[];
  console.log('  ' + 'id'.padEnd(9) + 'name'.padEnd(26) + 'email'.padEnd(30) + 'active');
  for (const r of railToday) {
    console.log('  ' + String(r.id).padEnd(9) + String(r.name ?? '—').padEnd(26)
      + String(r.email ?? '').padEnd(30) + r.active_count);
  }

  // After the preference, reconcileEscrowOfficerFlagsFromOrders (which only
  // ever SETS the flag, never clears it) would add 12/14/15/16 to this set
  // while 8996/10642/10999/17165 keep theirs.
  console.log('\n=== the same rail once the reconciler flags the officer-feed rows too ===');
  const railAfter = await sql.unsafe(`
    select c.id,
           coalesce(nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''),
                    c.full_name, c.officer_name) as name,
           c.email,
           (c.email ilike '%@pct.com'
             or exists (select 1 from profiles p where p.contact_id = c.id)) as passes_internal_filter
      from contacts c
     where c.id in (12,14,15,16,8996,10642,10999,17165)
     order by 2, 1
  `) as unknown as Row[];
  console.log('  ' + 'id'.padEnd(9) + 'name'.padEnd(26) + 'email'.padEnd(30) + 'appears in rail?');
  for (const r of railAfter) {
    console.log('  ' + String(r.id).padEnd(9) + String(r.name ?? '—').padEnd(26)
      + String(r.email ?? '(null)').padEnd(30) + (r.passes_internal_filter ? 'yes' : 'NO'));
  }

  // ── prelim + confirmation, per row ────────────────────────────────────────
  console.log('\n=== prelim primary recipient and confirmation escrow CC, per row ===');
  console.log('  resolvePrelimRecipients: officer FK set but email invalid => NO primary recipient');
  console.log('  (the escrow_company fallback is in the else-branch of "if (order.escrowOfficerId)")\n');
  const rows = await sql.unsafe(`
    select c.id, c.full_name, c.email, c.phone,
           (select count(*)::int from orders o where o.escrow_officer_id = c.id) as orders
      from contacts c where c.id in (12,14,15,16,8996,10642,10999,17165)
     order by c.full_name, c.id
  `) as unknown as Row[];
  console.log('  ' + 'id'.padEnd(9) + 'name'.padEnd(22) + 'orders'.padEnd(8)
    + 'prelim TO'.padEnd(26) + 'conf CC'.padEnd(26) + 'wizard phone');
  for (const r of rows) {
    const ok = isValidEmail(r.email);
    console.log('  ' + String(r.id).padEnd(9) + String(r.full_name).padEnd(22)
      + String(r.orders).padEnd(8)
      + (ok ? String(r.email) : 'NONE — blocked + warning').padEnd(26)
      + (ok ? String(r.email) : 'officer dropped').padEnd(26)
      + (r.phone ? String(r.phone) : 'NONE'));
  }

  // ── is the party wizard live at all? ──────────────────────────────────────
  console.log('\n=== settings that gate the party wizard ===');
  const settings = await sql.unsafe(`
    select key, value from settings where key ilike '%party_wizard%' or key ilike '%prelim%'
     order by key
  `) as unknown as Row[];
  for (const s of settings) console.log(`  ${String(s.key).padEnd(40)} ${s.value}`);

  await sql.end();
  process.exit(0);
})();
