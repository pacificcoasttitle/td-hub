/**
 * READ-ONLY. Two competing explanations for every create_order failure:
 *
 *   A. branch/examiner mismatch  — LookUpCodeTitleOffice is not the branch the
 *                                  TitleOffice examiner belongs to
 *   B. unhandled branch          — the adapter's CreateOrders suffix switch has
 *                                  cases for "glt" and "oct" and no default, so
 *                                  any other code falls through with no suffix
 *
 * Scored against all 15 logged attempts, and against each other: which one
 * explains more, and is there any attempt that separates them?
 */
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const ADAPTER_CASES = new Set(['glt', 'oct']);
(async () => {
  const rows = await sql.unsafe(`
    select v.created_at, v.success,
      v.request_meta->'payload'->'transactionDetails'->>'LookUpCodeTitleOffice' as branch,
      v.request_meta->'payload'->'transactionDetails'->>'TitleOffice' as examiner
    from vendor_api_logs v
    where v.vendor='softpro' and v.operation='create_order' order by v.created_at`);
  const owners = await sql.unsafe(`
    select softpro_lookup_code as ex, string_agg(distinct coalesce(office_lookup_code, lookup_code), ',') as branches
    from contacts where nullif(trim(softpro_lookup_code),'') is not null group by 1`);
  const byEx = new Map(owners.map(o => [String(o.ex).toLowerCase(), String(o.branches ?? '')]));

  let aRight = 0, bRight = 0, separating = 0;
  console.log(`${'when'.padEnd(18)} ${'result'.padEnd(7)} ${'branch'.padEnd(8)} ${'in switch?'.padEnd(11)} ${'examiner match?'.padEnd(16)} A predicts  B predicts`);
  for (const r of rows) {
    const branch = String(r.branch ?? '');
    const ex = String(r.examiner ?? '').toLowerCase();
    const inSwitch = ADAPTER_CASES.has(branch.toLowerCase());
    const exBranches = byEx.get(ex);
    // A only makes a prediction when the examiner is a known person code.
    const aApplies = exBranches !== undefined;
    const aMatch = aApplies && exBranches.split(',').includes(branch);
    const aPred = aApplies ? (aMatch ? 'OK' : 'FAIL') : '(silent)';
    const bPred = inSwitch ? 'OK' : 'FAIL';
    const actual = r.success ? 'OK' : 'FAIL';
    if (aPred === actual) aRight++;
    if (bPred === actual) bRight++;
    if (aPred !== '(silent)' && aPred !== bPred) separating++;
    console.log(
      `${(r.created_at as Date).toISOString().slice(0,16).padEnd(18)} ${actual.padEnd(7)} ${(branch||'—').padEnd(8)} ` +
      `${(inSwitch?'yes':'NO').padEnd(11)} ${(aApplies ? (aMatch?'yes':'no') : 'n/a').padEnd(16)} ` +
      `${aPred.padEnd(11)} ${bPred}` + (aPred !== '(silent)' && aPred !== bPred ? '   <-- SEPARATES' : ''));
  }
  console.log(`\nA (examiner mismatch) correct on ${aRight}/${rows.length}`);
  console.log(`B (branch not in switch) correct on ${bRight}/${rows.length}`);
  console.log(`attempts that DISTINGUISH the two: ${separating}`);
  await sql.end(); process.exit(0);
})();
