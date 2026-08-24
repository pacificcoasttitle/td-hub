/**
 * Applies docs/migration-market-reports.sql inside a transaction that is ALWAYS
 * rolled back, then exercises every CHECK constraint with rows that should be
 * accepted and rows that must be refused.
 *
 * A constraint nobody has tried to violate is a comment, not a guarantee.
 */
import fs from 'node:fs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const DDL = fs.readFileSync('docs/migration-market-reports.sql', 'utf8');

const pass = [];
const fail = [];
const ok = (m) => { pass.push(m); console.log(`  ok    ${m}`); };
const bad = (m, e) => { fail.push(m); console.log(`  FAIL  ${m}${e ? ` :: ${e}` : ''}`); };

// Postgres aborts the entire transaction on the first error, so every statement
// that is EXPECTED to fail must run inside its own savepoint. Without that, the
// first refusal poisons everything after it and the run reports one real result
// followed by thirty "transaction is aborted" failures that say nothing at all
// about the schema.
let sp = 0;

/** Expect the statement to succeed, and KEEP its effect — later checks build on these rows. */
async function accepts(t, label, stmt) {
  const name = `sp_${++sp}`;
  await t.unsafe(`SAVEPOINT ${name}`);
  try {
    await t.unsafe(stmt);
    await t.unsafe(`RELEASE SAVEPOINT ${name}`);
    ok(`accepts  ${label}`);
  } catch (e) {
    await t.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    await t.unsafe(`RELEASE SAVEPOINT ${name}`);
    bad(`accepts  ${label}`, (e.message ?? '').split('\n')[0]);
  }
}

/**
 * Expect the statement to be refused BY A NAMED CONSTRAINT — not merely to
 * fail, which a typo in the test would also achieve.
 */
async function refuses(t, label, constraintFragment, stmt) {
  const name = `sp_${++sp}`;
  await t.unsafe(`SAVEPOINT ${name}`);
  let accepted = false;
  let msg = '';
  try { await t.unsafe(stmt); accepted = true; }
  catch (e) { msg = e.message ?? ''; }
  await t.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);
  await t.unsafe(`RELEASE SAVEPOINT ${name}`);

  if (accepted) bad(`refuses  ${label} — statement was ACCEPTED`);
  else if (msg.includes(constraintFragment)) ok(`refuses  ${label}`);
  else bad(`refuses  ${label} — wrong reason`, msg.split('\n')[0]);
}

try {
  await sql.begin(async (t) => {
    console.log('── applying DDL ────────────────────────────────');
    await t.unsafe(DDL);
    console.log('  DDL applied\n');

    const [prof] = await t.unsafe(`select id from profiles limit 1`);
    const [cont] = await t.unsafe(`select id from contacts limit 1`);
    const P = `'${prof.id}'`;
    const C = cont.id;

    // ── datasets ────────────────────────────────────────────────────────────
    console.log('── market_report_datasets ──────────────────────');
    await accepts(t, 'a real CSV upload', `
      insert into market_report_datasets
        (id, report_type, schema_version, origin, original_filename, source_sha256,
         source_bytes, source_storage_key, detected_headers, rows_total,
         rows_accepted, rows_rejected, data_as_of, status, created_by)
      values (1, 'county_sales', 'v1', 'csv_upload', 'glendale.csv',
        '${'a'.repeat(64)}', 20481, 'market-reports/src/1.csv',
        '["Site City","Purchase Price"]'::jsonb, 100, 97, 3, '2026-07-31',
        'accepted', ${P})`);

    await accepts(t, 'a SiteX farm retrieval with no file', `
      insert into market_report_datasets
        (id, report_type, schema_version, origin, retrieval_request,
         rows_total, rows_accepted, rows_rejected, status)
      values (2, 'county_sales', 'v1', 'sitex_farm',
        '{"farm_city":["GLENDALE"],"farm_recording_date":"20260501-20260731"}'::jsonb,
        50, 50, 0, 'accepted')`);

    await refuses(t, 'an upload with no file hash', 'upload_has_file', `
      insert into market_report_datasets
        (report_type, schema_version, origin, rows_total, rows_accepted, rows_rejected)
      values ('county_sales', 'v1', 'csv_upload', 1, 1, 0)`);

    await refuses(t, 'a retrieval with no request', 'retrieval_has_request', `
      insert into market_report_datasets
        (report_type, schema_version, origin, rows_total, rows_accepted, rows_rejected)
      values ('county_sales', 'v1', 'sitex_farm', 1, 1, 0)`);

    await refuses(t, 'row counts that do not add up', 'counts_sane', `
      insert into market_report_datasets
        (report_type, schema_version, origin, retrieval_request,
         rows_total, rows_accepted, rows_rejected)
      values ('county_sales', 'v1', 'sitex_farm', '{}'::jsonb, 100, 97, 2)`);

    await refuses(t, 'a rejected dataset with no reason', 'rejected_has_reason', `
      insert into market_report_datasets
        (report_type, schema_version, origin, retrieval_request,
         rows_total, rows_accepted, rows_rejected, status)
      values ('county_sales', 'v1', 'sitex_farm', '{}'::jsonb, 0, 0, 0, 'rejected')`);

    await refuses(t, 'an uppercase sha256', 'sha_lower', `
      insert into market_report_datasets
        (report_type, schema_version, origin, source_sha256, source_storage_key,
         rows_total, rows_accepted, rows_rejected)
      values ('county_sales', 'v1', 'csv_upload', '${'A'.repeat(64)}', 'k', 0, 0, 0)`);

    await refuses(t, 'an unknown report type', 'type_check', `
      insert into market_report_datasets
        (report_type, schema_version, origin, retrieval_request,
         rows_total, rows_accepted, rows_rejected)
      values ('sales_snapshot_v0', 'v1', 'sitex_farm', '{}'::jsonb, 0, 0, 0)`);

    // ── sale records ────────────────────────────────────────────────────────
    console.log('\n── market_sale_records ─────────────────────────');
    await accepts(t, 'a fully populated sale', `
      insert into market_sale_records
        (dataset_id, row_number, site_city, site_city_raw, site_zip, apn,
         use_code, use_code_description, property_class, sale_price, sale_date,
         bedrooms, baths, building_area, lot_area, year_built, owner_occupied, raw)
      values (1, 1, 'GLENDALE', 'Glendale ', '91203', '5636-018-014',
        '0100', 'Single Family Residence', 'sfr', 835000.00, '2026-06-14',
        3, 2.5, 1487, 6625, 1948, true, '{"Site City":"Glendale "}'::jsonb)`);

    await accepts(t, 'occupancy unknown (NULL, not guessed)', `
      insert into market_sale_records
        (dataset_id, row_number, site_city, property_class, sale_price, sale_date,
         owner_occupied, raw)
      values (1, 2, 'GLENDALE', 'condo', 512000.00, '2026-06-02', null, '{}'::jsonb)`);

    await accepts(t, 'a $0 recording — stored, not nulled', `
      insert into market_sale_records
        (dataset_id, row_number, site_city, property_class, sale_price, raw)
      values (1, 3, 'GLENDALE', 'sfr', 0, '{}'::jsonb)`);

    await accepts(t, 'an unclassifiable property type', `
      insert into market_sale_records
        (dataset_id, row_number, site_city, property_class, raw)
      values (1, 4, 'GLENDALE', 'unknown', '{}'::jsonb)`);

    await refuses(t, 'a negative sale price', 'price_sane', `
      insert into market_sale_records (dataset_id, row_number, property_class, sale_price, raw)
      values (1, 90, 'sfr', -1, '{}'::jsonb)`);

    await refuses(t, 'a made-up property class', 'class_check', `
      insert into market_sale_records (dataset_id, row_number, property_class, raw)
      values (1, 91, 'townhome', '{}'::jsonb)`);

    await refuses(t, 'a duplicate source row', 'row_unique', `
      insert into market_sale_records (dataset_id, row_number, property_class, raw)
      values (1, 1, 'sfr', '{}'::jsonb)`);

    await refuses(t, 'an impossible year built', 'year_sane', `
      insert into market_sale_records (dataset_id, row_number, property_class, year_built, raw)
      values (1, 92, 'sfr', 202, '{}'::jsonb)`);

    await refuses(t, 'a negative building area', 'area_sane', `
      insert into market_sale_records (dataset_id, row_number, property_class, building_area, raw)
      values (1, 93, 'sfr', -5, '{}'::jsonb)`);

    // ── runs ────────────────────────────────────────────────────────────────
    console.log('\n── market_report_runs ──────────────────────────');
    const RUN = (id, extra, cols = '', vals = '') => `
      insert into market_report_runs
        (id, report_type, dataset_id, data_source, status, area_label,
         period_start, period_end, calculation_version, template_version${cols})
      values (${id}, 'county_sales', 1, 'csv_upload', ${extra}, 'Glendale 91203',
        '2026-05-01', '2026-07-31', 'v1', 'v1'${vals})`;

    await accepts(t, 'a queued run', RUN(10, `'queued'`));

    await accepts(t, 'a generated run with a PDF and a comparison window',
      RUN(11, `'generated'`,
        `, pdf_storage_key, pdf_sha256, pdf_bytes, pdf_page_count, completed_at,
           compare_start, compare_end, property_class, records_considered,
           records_matched, rep_contact_id, rep_snapshot, public_id`,
        `, 'market-reports/pdf/11.pdf', '${'b'.repeat(64)}', 210000, 1, now(),
           '2026-02-01', '2026-04-30', 'sfr', 100, 62, ${C},
           '{"name":"Jerry Hernandez","title":"Sales Rep"}'::jsonb,
           '11111111-1111-1111-1111-111111111111'`));

    await accepts(t, 'property_class NULL — an all-types report',
      RUN(12, `'generated'`,
        `, pdf_storage_key, pdf_sha256, completed_at, property_class`,
        `, 'k', '${'c'.repeat(64)}', now(), null`));

    await refuses(t, 'a generated run with no PDF', 'generated_has_pdf',
      RUN(13, `'generated'`, `, completed_at`, `, now()`));

    await refuses(t, 'a failed run with no reason', 'failed_has_reason',
      RUN(14, `'failed'`, `, completed_at`, `, now()`));

    await refuses(t, 'a finished run with no completion time', 'generated_has_completion',
      RUN(15, `'failed'`, `, error_message`, `, 'boom'`));

    await refuses(t, 'a period that runs backwards', 'period_order', `
      insert into market_report_runs
        (report_type, dataset_id, data_source, status, area_label,
         period_start, period_end, calculation_version, template_version)
      values ('county_sales', 1, 'csv_upload', 'queued', 'x',
        '2026-07-31', '2026-05-01', 'v1', 'v1')`);

    await refuses(t, 'half a comparison window', 'compare_complete',
      RUN(16, `'queued'`, `, compare_start`, `, '2026-02-01'`));

    await refuses(t, 'a comparison window overlapping the period', 'compare_order',
      RUN(17, `'queued'`, `, compare_start, compare_end`, `, '2026-04-01', '2026-06-30'`));

    await refuses(t, 'more matched than considered', 'counts_sane',
      RUN(18, `'queued'`, `, records_considered, records_matched`, `, 10, 11`));

    await refuses(t, 'a CSV run with no dataset', 'upload_has_dataset', `
      insert into market_report_runs
        (report_type, dataset_id, data_source, status, area_label,
         period_start, period_end, calculation_version, template_version)
      values ('county_sales', null, 'csv_upload', 'queued', 'x',
        '2026-05-01', '2026-07-31', 'v1', 'v1')`);

    await refuses(t, 'a duplicate public_id', 'public_id_unique',
      RUN(19, `'queued'`, `, public_id`, `, '11111111-1111-1111-1111-111111111111'`));

    await refuses(t, 'a stage outside the pipeline', 'status_check',
      RUN(20, `'rendering'`));

    // ── deliveries ──────────────────────────────────────────────────────────
    console.log('\n── market_report_deliveries ────────────────────');
    await accepts(t, 'a sent delivery to a server-resolved rep', `
      insert into market_report_deliveries
        (run_id, recipient_email, recipient_name, recipient_source, status,
         provider, provider_message_id, sent_at, requested_by)
      values (11, 'rep@pct.com', 'Jerry Hernandez', 'rep_contact', 'sent',
        'sendgrid', 'abc123', now(), ${P})`);

    await refuses(t, 'a browser-supplied recipient source', 'source_check', `
      insert into market_report_deliveries
        (run_id, recipient_email, recipient_source, status)
      values (11, 'anyone@example.com', 'client_supplied', 'queued')`);

    await refuses(t, 'a sent delivery with no timestamp', 'sent_has_time', `
      insert into market_report_deliveries
        (run_id, recipient_email, recipient_source, status)
      values (11, 'rep@pct.com', 'rep_contact', 'sent')`);

    await refuses(t, 'a failed delivery with no reason', 'failed_has_reason', `
      insert into market_report_deliveries
        (run_id, recipient_email, recipient_source, status)
      values (11, 'rep@pct.com', 'rep_contact', 'failed')`);

    await refuses(t, 'a recipient that is not an address', 'email_shape', `
      insert into market_report_deliveries
        (run_id, recipient_email, recipient_source, status)
      values (11, 'not-an-email', 'rep_contact', 'queued')`);

    // ── cascade behaviour ───────────────────────────────────────────────────
    console.log('\n── referential behaviour ───────────────────────');

    // The evidence a report was built from must not be deletable while the
    // report exists. Runs 10-12 all cite dataset 1.
    await refuses(t, 'deleting a dataset a report was calculated from',
      'violates foreign key constraint',
      `delete from market_report_datasets where id = 1`);

    // A dataset nothing cites is deletable, and takes its rows with it.
    await accepts(t, 'an unused dataset with rows', `
      insert into market_report_datasets
        (id, report_type, schema_version, origin, retrieval_request,
         rows_total, rows_accepted, rows_rejected)
      values (3, 'county_sales', 'v1', 'sitex_farm', '{}'::jsonb, 2, 2, 0)`);
    await accepts(t, 'rows against the unused dataset', `
      insert into market_sale_records (dataset_id, row_number, property_class, raw)
      values (3, 1, 'sfr', '{}'::jsonb), (3, 2, 'condo', '{}'::jsonb)`);
    await t.unsafe(`delete from market_report_datasets where id = 3`);
    const [{ orphans }] = await t.unsafe(
      `select count(*)::int as orphans from market_sale_records where dataset_id = 3`);
    if (Number(orphans) === 0) ok('deleting an unused dataset cascades to its records');
    else bad(`cascade left ${orphans} orphaned records`);

    console.log('\n── rolling back ───────────────────────────────');
    throw new Error('ROLLBACK_ON_PURPOSE');
  });
} catch (e) {
  if (!String(e.message).includes('ROLLBACK_ON_PURPOSE')) {
    console.error('\nUNEXPECTED:', e.message);
    process.exitCode = 1;
  } else {
    console.log('  rolled back — production schema untouched');
  }
}

const [{ leaked }] = await sql.unsafe(`
  select count(*)::int as leaked from information_schema.tables
  where table_name like 'market\\_%'`);
console.log(`\nleft behind in production: ${leaked} tables (must be 0)`);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
if (fail.length || leaked !== 0) process.exitCode = 1;
await sql.end();
