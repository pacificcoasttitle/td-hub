/**
 * READ-ONLY. Does the branch code we send belong to the same person as the
 * examiner code we send?
 *
 * resolveBranchCode() switches to the ESCROW officer when orderType is
 * 'Title & Escrow' or 'Escrow only', while TitleOffice always carries the TITLE
 * officer's examiner lookup. On those order types the two can describe
 * different people at different branches.
 */
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
(async () => {
  const rows = await sql.unsafe(`
    select v.id, v.created_at, v.success,
      v.request_meta->'payload'->'baseDetails'->>'OrderType' as order_type,
      v.request_meta->'payload'->'transactionDetails'->>'LookUpCodeTitleOffice' as branch,
      v.request_meta->'payload'->'transactionDetails'->>'TitleOffice' as examiner,
      v.request_meta->'payload'->'transactionDetails'->>'EscrowOfficerName' as escrow_officer
    from vendor_api_logs v
    where v.vendor='softpro' and v.operation='create_order'
    order by v.created_at`);

  // Which branch does each examiner code actually belong to, per contacts?
  const owners = await sql.unsafe(`
    select softpro_lookup_code as examiner,
           string_agg(distinct coalesce(office_lookup_code, lookup_code), ',') as branches,
           string_agg(distinct full_name, ',') as who
    from contacts where softpro_lookup_code is not null and trim(softpro_lookup_code) <> ''
    group by 1`);
  const byExaminer = new Map(owners.map(o => [String(o.examiner).toLowerCase(), o]));

  console.log(`${'when'.padEnd(20)} ${'ok'.padEnd(6)} ${'orderType'.padEnd(15)} ${'branch'.padEnd(8)} ${'examiner'.padEnd(20)} examiner belongs to`);
  for (const r of rows) {
    const ex = String(r.examiner ?? '').toLowerCase();
    const o = byExaminer.get(ex);
    const belongs = o ? `${o.who} @ ${o.branches}` : '(examiner not in contacts)';
    const branch = String(r.branch ?? '—');
    const agrees = o && String(o.branches ?? '').split(',').includes(branch);
    console.log(
      `${(r.created_at as Date).toISOString().slice(0,16).padEnd(20)} ${(r.success?'OK':'FAIL').padEnd(6)} ` +
      `${String(r.order_type ?? '—').padEnd(15)} ${branch.padEnd(8)} ${String(r.examiner ?? '—').padEnd(20)} ${belongs}` +
      (r.examiner ? (agrees ? '   [branch agrees]' : '   *** BRANCH/EXAMINER MISMATCH ***') : ''));
  }
  await sql.end(); process.exit(0);
})();
