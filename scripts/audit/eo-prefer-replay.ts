/**
 * READ-ONLY. Complete replay of the inbound escrow-officer resolver.
 *
 * Every contact SoftPro has ever named as an escrow officer on any order is
 * re-resolved twice in one process: once through the resolvers exactly as they
 * stand at 46e05ee (scripts/audit/eo-resolver-baseline.ts, a frozen copy), and
 * once through the live module. The question this answers is not "does the fix
 * work" but "does anything stop resolving", which is the way the previous
 * attempt at this change was caught.
 *
 * The inbound values are reconstructed from the contact rows themselves, which
 * is sound because refreshOfficerContact in process-detail.ts writes SoftPro's
 * LookupCode and Name straight onto whichever contact resolved — the stored
 * columns ARE the feed values.
 *
 *   npx tsx --env-file=.env.local scripts/audit/eo-prefer-replay.ts
 */
import postgres from 'postgres';
import {
  resolveEscrowOfficerId,
  resolveOfficerIdByLookupCode,
  type ContactRecord,
} from '@/lib/domain/orders/process-detail';
import {
  baselineResolveEscrowOfficerId,
  baselineResolveOfficerIdByLookupCode,
  type BaselineContactRecord,
} from './eo-resolver-baseline';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

const INTERNAL_OFFICER_ROW = `(
  roles::jsonb @> '["escrow_officer"]'::jsonb
  and left(softpro_lookup_code, 4) = 'PCT\\'
  and office_lookup_code is not null and office_lookup_code <> ''
)`;

const COLUMNS = `id, first_name, last_name, full_name, officer_name,
                 softpro_lookup_code, source_id, email, phone`;

interface RawContact {
  id: number;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  officer_name: string | null;
  softpro_lookup_code: string | null;
  source_id: string | null;
  email: string | null;
  phone: string | null;
  is_internal_officer_row?: boolean;
}

function toRecord(r: RawContact): ContactRecord {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    fullName: r.full_name,
    officerName: r.officer_name,
    softproLookupCode: r.softpro_lookup_code,
    sourceId: r.source_id,
    email: r.email,
    phone: r.phone,
    isInternalOfficerRow: r.is_internal_officer_row === true,
  };
}

function toBaseline(r: RawContact): BaselineContactRecord {
  const { isInternalOfficerRow: _drop, ...rest } = toRecord(r);
  return rest;
}

/** What SoftPro sends for this person, as recorded on their own contact row. */
function feedValues(r: RawContact): { lookupCode: string | null; name: string | null } {
  const constructed = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();
  return {
    lookupCode: r.softpro_lookup_code?.trim() || r.source_id?.trim() || null,
    name: r.officer_name?.trim() || r.full_name?.trim() || constructed || null,
  };
}

(async () => {
  const [{ now }] = await sql.unsafe(`select now() at time zone 'utc' as now`) as unknown as Record<string, unknown>[];
  console.log(`replay run (db utc): ${now}`);

  // ── candidate sets, exactly as each version of loadEscrowOfficers builds ───
  const beforeRaw = await sql.unsafe(
    `select ${COLUMNS} from contacts where is_escrow_officer = true order by id`,
  ) as unknown as RawContact[];

  const afterRaw = await sql.unsafe(
    `select ${COLUMNS}, ${INTERNAL_OFFICER_ROW} as is_internal_officer_row
       from contacts
      where is_escrow_officer = true or ${INTERNAL_OFFICER_ROW}
      order by id`,
  ) as unknown as RawContact[];

  const before = beforeRaw.map(toBaseline);
  const after = afterRaw.map(toRecord);

  console.log(`\ncandidates BEFORE (is_escrow_officer = true):        ${before.length}`);
  console.log(`candidates AFTER  (that OR internalOfficerFilter):    ${after.length}`);
  console.log(`officer-feed rows flagged in the AFTER set:          `
    + `${after.filter((c) => c.isInternalOfficerRow).length}`);

  // ── the population being replayed ─────────────────────────────────────────
  // Every contact ever named as an escrow officer: the flagged candidates plus
  // any contact an order actually points at, in case the two ever disagree.
  const population = await sql.unsafe(`
    select ${COLUMNS},
           (select count(*) from orders o where o.escrow_officer_id = c.id)::int as order_count
      from contacts c
     where c.is_escrow_officer = true
        or exists (select 1 from orders o where o.escrow_officer_id = c.id)
     order by c.id
  `) as unknown as (RawContact & { order_count: number })[];

  console.log(`population replayed (every escrow officer ever assigned): ${population.length}`);
  console.log(`orders they account for: ${population.reduce((n, r) => n + r.order_count, 0)}`);

  // ── replay ────────────────────────────────────────────────────────────────
  type Outcome = 'same' | 'moved' | 'null';
  const buckets: Record<Outcome, { officers: number; orders: number }> = {
    same: { officers: 0, orders: 0 },
    moved: { officers: 0, orders: 0 },
    null: { officers: 0, orders: 0 },
  };
  const moved: string[] = [];
  const lost: string[] = [];

  for (const row of population) {
    const { lookupCode, name } = feedValues(row);

    const oldId = baselineResolveOfficerIdByLookupCode(lookupCode, before)
      ?? baselineResolveEscrowOfficerId(name, before);
    const newId = resolveOfficerIdByLookupCode(lookupCode, after)
      ?? resolveEscrowOfficerId(name, after);

    const outcome: Outcome = newId === null ? 'null' : newId === oldId ? 'same' : 'moved';
    buckets[outcome].officers += 1;
    buckets[outcome].orders += row.order_count;

    const label = `contact ${row.id} ${JSON.stringify(name)} code=${JSON.stringify(lookupCode)}`
      + ` orders=${row.order_count}: ${oldId} -> ${newId}`;
    if (outcome === 'moved') moved.push(label);
    if (outcome === 'null') lost.push(label);
  }

  console.log('\n=== replay: every escrow officer ever assigned on any order ===');
  console.log('  ' + 'Outcome'.padEnd(46) + 'Officers'.padEnd(11) + 'Orders');
  console.log('  ' + 'Resolves to the same row'.padEnd(46)
    + String(buckets.same.officers).padEnd(11) + buckets.same.orders);
  console.log('  ' + 'Resolves to a different row'.padEnd(46)
    + String(buckets.moved.officers).padEnd(11) + buckets.moved.orders);
  console.log('  ' + 'Stops resolving, writes NULL'.padEnd(46)
    + String(buckets.null.officers).padEnd(11) + buckets.null.orders);

  console.log(`\n=== the ${moved.length} that move ===`);
  for (const m of moved) console.log('  ' + m);

  console.log(`\n=== the ${lost.length} that stop resolving ===`);
  if (lost.length === 0) console.log('  none');
  for (const l of lost.slice(0, 40)) console.log('  ' + l);

  // ── does the wider candidate set steal anyone? ────────────────────────────
  // The four officer-feed rows added to the set answer to names. If any other
  // contact shares one of those names, the union alone would change their
  // resolution without the preference having anything to do with it.
  console.log('\n=== name collisions introduced by the four added officer-feed rows ===');
  const added = after.filter((c) => c.isInternalOfficerRow && !beforeRaw.some((b) => b.id === c.id));
  console.log(`  added rows: ${added.map((a) => `${a.id} ${a.fullName}`).join(', ')}`);
  for (const a of added) {
    const names = new Set([
      (a.officerName ?? '').trim().toLowerCase(),
      (a.fullName ?? '').trim().toLowerCase(),
    ].filter(Boolean));
    const clashes = population.filter((p) => {
      if (p.id === a.id) return false;
      const pn = [(p.officer_name ?? '').trim().toLowerCase(), (p.full_name ?? '').trim().toLowerCase()];
      return pn.some((n) => n && names.has(n));
    });
    console.log(`  ${a.id} ${a.fullName}: ${clashes.length} other contact(s) answering the same name`
      + (clashes.length ? ` -> ${clashes.map((c) => `${c.id} (${c.order_count} orders)`).join(', ')}` : ''));
  }

  // ── title officers and sales reps: the tie-break alone ────────────────────
  // Those loaders gained the id tie-break but no preference. Confirm it is
  // inert: no two candidates in either set match the same name.
  console.log('\n=== tie-break is inert for title officers and sales reps ===');
  for (const [label, flag] of [['title officers', 'is_title_officer'], ['sales reps', 'is_sales_rep']] as const) {
    const dupes = await sql.unsafe(`
      select lower(coalesce(nullif(officer_name,''), full_name)) as nm, count(*) as n,
             string_agg(id::text, ',' order by id) as ids
        from contacts where ${flag} = true
         and coalesce(nullif(officer_name,''), full_name) is not null
       group by 1 having count(*) > 1
    `) as unknown as Record<string, unknown>[];
    console.log(`  ${label}: ${dupes.length} name(s) matched by more than one candidate`);
    for (const d of dupes) console.log(`    ${d.nm} -> ${d.ids}`);
  }

  await sql.end();
  process.exit(lost.length === 0 ? 0 : 1);
})();
