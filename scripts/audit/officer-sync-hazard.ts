/**
 * READ-ONLY. Measures the syncEscrowOfficers non-deterministic-match hazard.
 *
 * Four questions, in order:
 *   1. Does a unique index on closer_examiner actually exist, and is it partial?
 *      (The Drizzle schema declares a PLAIN index. If nothing is unique, the
 *      failure mode is not a swallowed constraint violation — it is a silent
 *      write to the wrong row, which leaves no error to surface at all.)
 *   2. Which contacts rows are ambiguous under the current match predicate
 *      `closer_examiner = X OR softpro_lookup_code = X`?
 *   3. Has the swallowed error already been recorded anywhere —
 *      contact_sync_state.last_result.errors, contact_sync_state.last_error,
 *      jobs.error, or vendor_api_logs?
 *   4. Is any officer's contacts row stale as a consequence?
 *
 * No writes. Every statement is a SELECT.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

type Row = Record<string, unknown>;

function table(rows: Row[], cols: string[]): void {
  if (rows.length === 0) {
    console.log('  (no rows)');
    return;
  }
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)),
  );
  console.log('  ' + cols.map((c, i) => c.padEnd(widths[i]!)).join('  '));
  console.log('  ' + widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) {
    console.log('  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i]!)).join('  '));
  }
}

function section(title: string): void {
  console.log(`\n\n${'='.repeat(100)}\n${title}\n${'='.repeat(100)}`);
}

(async () => {
  section('1. INDEXES ON contacts — is there a partial unique on closer_examiner?');
  const idx = await sql.unsafe(`
    select indexname, indexdef
      from pg_indexes
     where tablename = 'contacts'
     order by indexname
  `) as unknown as Row[];
  for (const r of idx) {
    const def = String(r.indexdef);
    const flag = def.includes('UNIQUE') ? ' <== UNIQUE' : '';
    console.log(`  ${String(r.indexname)}${flag}\n      ${def}`);
  }

  section('1b. All UNIQUE constraints/indexes on contacts, from pg_constraint too');
  const cons = await sql.unsafe(`
    select conname, contype, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'contacts'::regclass
     order by conname
  `) as unknown as Row[];
  table(cons, ['conname', 'contype', 'def']);

  section('2. The six named PCT escrow officers — both rows of each pair');
  const officers = await sql.unsafe(`
    with named as (
      select id, officer_name, full_name, first_name, last_name, email,
             lookup_code, office_lookup_code, softpro_lookup_code, closer_examiner,
             source_system, source_id, roles::text as roles,
             is_escrow_officer, is_title_officer, is_active,
             created_at, updated_at
        from contacts
       where lower(coalesce(officer_name, full_name, last_name, '')) ~
             '(ballesteros|gomez|casco|vidaca|ayala|quintanar)'
         and (
           left(coalesce(softpro_lookup_code,''), 4) = 'PCT\\'
           or left(coalesce(source_id,''), 4) = 'PCT\\'
           or coalesce(softpro_lookup_code,'') ~ 'Paci$'
         )
    )
    select n.*,
           (select count(*) from orders o where o.escrow_officer_id = n.id)  as ord_eo,
           (select count(*) from orders o where o.title_officer_id  = n.id)  as ord_to,
           (select count(*) from order_parties p where p.contact_id = n.id)  as parties,
           (select count(*) from orders o where o.client_contact_id = n.id)  as client_c
      from named n
     order by lower(coalesce(n.officer_name, n.full_name, n.last_name)), n.id
  `) as unknown as Row[];
  table(officers, [
    'id', 'officer_name', 'office_lookup_code', 'softpro_lookup_code', 'closer_examiner',
    'source_id', 'is_escrow_officer', 'is_active', 'ord_eo', 'parties', 'client_c',
    'updated_at',
  ]);

  section('3. AMBIGUITY: which incoming examiner codes match MORE THAN ONE contacts row?');
  console.log(`
Every value that appears in closer_examiner or softpro_lookup_code is a possible
incoming "Escrow officer/Closer" code. For each distinct value, count the rows the
current predicate would match. n>1 means .limit(1) with no ORDER BY picks one at
the planner's discretion.
`);
  const ambiguous = await sql.unsafe(`
    with codes as (
      select distinct closer_examiner as code from contacts where closer_examiner is not null
      union
      select distinct softpro_lookup_code as code from contacts where softpro_lookup_code is not null
    )
    select c.code,
           (select count(*) from contacts x
             where x.closer_examiner = c.code or x.softpro_lookup_code = c.code) as n_matched,
           (select string_agg(x.id::text || ':' || coalesce(x.office_lookup_code,'-')
                              || ':eo=' || x.is_escrow_officer::text, ' | ' order by x.id)
              from contacts x
             where x.closer_examiner = c.code or x.softpro_lookup_code = c.code) as rows_matched
      from codes c
     where (select count(*) from contacts x
             where x.closer_examiner = c.code or x.softpro_lookup_code = c.code) > 1
     order by n_matched desc, c.code
  `) as unknown as Row[];
  console.log(`  AMBIGUOUS CODES: ${ambiguous.length}`);
  table(ambiguous, ['code', 'n_matched', 'rows_matched']);

  section('3b. Of those, which are on the ESCROW OFFICER feed (PCT\\ codes)?');
  const ambigEscrow = ambiguous.filter((r) => String(r.code).startsWith('PCT\\'));
  console.log(`  PCT\\ ambiguous codes: ${ambigEscrow.length}`);
  table(ambigEscrow, ['code', 'n_matched', 'rows_matched']);

  section('4. contact_sync_state — the recorded results, where a swallowed error would sit');
  const state = await sql.unsafe(`
    select entity_type, job_type, status, total_fetched,
           last_synced_at, last_started_at, last_completed_at, next_allowed_at,
           last_error,
           jsonb_array_length(coalesce(last_result->'errors','[]'::jsonb)) as n_errors,
           last_result->'created'  as created,
           last_result->'updated'  as updated,
           last_result->'skipped'  as skipped,
           last_result->'errors'   as errors
      from contact_sync_state
     order by entity_type
  `) as unknown as Row[];
  table(state, [
    'entity_type', 'status', 'total_fetched', 'created', 'updated', 'skipped',
    'n_errors', 'last_synced_at', 'last_completed_at', 'last_error',
  ]);
  console.log('\n  --- full errors arrays, any entity type with n_errors > 0 ---');
  for (const r of state) {
    if (Number(r.n_errors) > 0) {
      console.log(`\n  ${String(r.entity_type)}:`);
      console.log('  ' + JSON.stringify(r.errors, null, 2).split('\n').join('\n  '));
    }
  }

  section('5. jobs table — sync_contacts runs and their errors');
  const jobRows = await sql.unsafe(`
    select id, job_type, status, attempts, error, started_at, ended_at, created_at
      from jobs
     where job_type ilike '%contact%'
     order by created_at desc
     limit 40
  `) as unknown as Row[];
  table(jobRows, ['id', 'job_type', 'status', 'attempts', 'created_at', 'ended_at', 'error']);

  section('5b. jobs — ANY row whose error mentions a unique violation / duplicate key');
  const dupErr = await sql.unsafe(`
    select id, job_type, status, created_at, left(error, 400) as error
      from jobs
     where error ilike '%duplicate key%'
        or error ilike '%unique%'
        or error ilike '%23505%'
     order by created_at desc
     limit 40
  `) as unknown as Row[];
  table(dupErr, ['id', 'job_type', 'status', 'created_at', 'error']);

  section('6. vendor_api_logs — GetLookupTable calls for the officer feeds');
  const logs = await sql.unsafe(`
    select id, vendor, operation, success, http_status, error_category,
           started_at, ended_at,
           left(coalesce(request_meta::text,''), 160)  as request_meta,
           left(coalesce(response_meta::text,''), 200) as response_meta
      from vendor_api_logs
     where operation ilike '%lookup%'
     order by started_at desc
     limit 30
  `) as unknown as Row[];
  table(logs, ['id', 'operation', 'success', 'http_status', 'error_category', 'started_at', 'request_meta', 'response_meta']);

  section('6b. vendor_api_logs — anything mentioning escrow officer or a duplicate key');
  const logs2 = await sql.unsafe(`
    select id, vendor, operation, success, error_category, started_at,
           left(coalesce(response_meta::text,''), 300) as response_meta
      from vendor_api_logs
     where coalesce(response_meta::text,'') ilike '%duplicate key%'
        or coalesce(response_meta::text,'') ilike '%escrow officer%'
        or error_category is not null
     order by started_at desc
     limit 30
  `) as unknown as Row[];
  table(logs2, ['id', 'operation', 'success', 'error_category', 'started_at', 'response_meta']);

  section('7. STALENESS: updated_at on every PCT\\ officer row');
  console.log(`
An officer the sync has silently stopped updating has an updated_at that stopped
moving while its twin (or its peers) kept moving. Peers updated by the same feed
run share an updated_at to the second.
`);
  const stale = await sql.unsafe(`
    select id, officer_name, office_lookup_code, softpro_lookup_code, source_id,
           is_escrow_officer, is_title_officer, is_active,
           created_at, updated_at,
           date_trunc('second', updated_at) as updated_sec
      from contacts
     where left(coalesce(softpro_lookup_code,''), 4) = 'PCT\\'
        or left(coalesce(source_id,''), 4) = 'PCT\\'
     order by updated_at desc, id
  `) as unknown as Row[];
  table(stale, [
    'id', 'officer_name', 'office_lookup_code', 'softpro_lookup_code',
    'is_escrow_officer', 'is_title_officer', 'is_active', 'created_at', 'updated_at',
  ]);

  section('8. JOB 2 EVIDENCE: loadEscrowOfficers (before) vs internalOfficerFilter (after)');
  const before = await sql.unsafe(`
    select id, officer_name, full_name, first_name, last_name,
           softpro_lookup_code, office_lookup_code, source_id, roles::text as roles,
           email
      from contacts
     where is_escrow_officer = true
     order by id
  `) as unknown as Row[];
  const after = await sql.unsafe(`
    select id, officer_name, full_name, first_name, last_name,
           softpro_lookup_code, office_lookup_code, source_id, roles::text as roles,
           email
      from contacts
     where roles::jsonb @> '["escrow_officer"]'::jsonb
       and left(coalesce(softpro_lookup_code,''), 4) = 'PCT\\'
       and office_lookup_code is not null
       and office_lookup_code <> ''
     order by id
  `) as unknown as Row[];
  console.log(`  BEFORE  is_escrow_officer = true                 -> ${before.length} rows`);
  console.log(`  AFTER   internalOfficerFilter('escrow_officer')  -> ${after.length} rows`);

  const afterIds = new Set(after.map((r) => Number(r.id)));
  const dropped = before.filter((r) => !afterIds.has(Number(r.id)));
  console.log(`\n  DROPPED by the change: ${dropped.length} rows`);

  section('8b. Of the dropped rows, which are REFERENCED by real orders? (regression risk)');
  const droppedRefs = await sql.unsafe(`
    select c.id, coalesce(c.officer_name, c.full_name) as name,
           c.email, c.softpro_lookup_code, c.office_lookup_code,
           (select count(*) from orders o where o.escrow_officer_id = c.id) as ord_eo,
           (select count(*) from order_parties p where p.contact_id = c.id) as parties,
           c.is_active
      from contacts c
     where c.is_escrow_officer = true
       and not (
         c.roles::jsonb @> '["escrow_officer"]'::jsonb
         and left(coalesce(c.softpro_lookup_code,''), 4) = 'PCT\\'
         and c.office_lookup_code is not null
         and c.office_lookup_code <> ''
       )
       and (select count(*) from orders o where o.escrow_officer_id = c.id) > 0
     order by ord_eo desc
     limit 60
  `) as unknown as Row[];
  console.log(`  Dropped rows that ARE referenced as orders.escrow_officer_id: ${droppedRefs.length} (top 60)`);
  table(droppedRefs, ['id', 'name', 'email', 'softpro_lookup_code', 'office_lookup_code', 'ord_eo', 'parties', 'is_active']);

  const [tot] = await sql.unsafe(`
    select count(*)::int as n_dropped_referenced,
           coalesce(sum(ord_eo),0)::int as orders_affected
      from (
        select (select count(*) from orders o where o.escrow_officer_id = c.id) as ord_eo
          from contacts c
         where c.is_escrow_officer = true
           and not (
             c.roles::jsonb @> '["escrow_officer"]'::jsonb
             and left(coalesce(c.softpro_lookup_code,''), 4) = 'PCT\\'
             and c.office_lookup_code is not null
             and c.office_lookup_code <> ''
           )
      ) s
     where ord_eo > 0
  `) as unknown as Row[];
  console.log(`\n  TOTAL dropped-and-referenced rows: ${String(tot!.n_dropped_referenced)}`);
  console.log(`  TOTAL orders whose escrow officer resolves to a dropped row: ${String(tot!.orders_affected)}`);

  section('8c. roles column on the six officers — does internalOfficerFilter reach them?');
  const rolesCheck = await sql.unsafe(`
    select id, coalesce(officer_name, full_name) as name, roles::text as roles,
           softpro_lookup_code, office_lookup_code, is_escrow_officer,
           (roles::jsonb @> '["escrow_officer"]'::jsonb) as has_role,
           (left(coalesce(softpro_lookup_code,''),4) = 'PCT\\') as pct_code,
           (office_lookup_code is not null and office_lookup_code <> '') as has_office
      from contacts
     where id in (11,12,13,14,15,16,8996,10642,10999,15523,17165,17626)
     order by id
  `) as unknown as Row[];
  table(rolesCheck, ['id', 'name', 'roles', 'softpro_lookup_code', 'office_lookup_code', 'is_escrow_officer', 'has_role', 'pct_code', 'has_office']);

  await sql.end();
  process.exit(0);
})();
