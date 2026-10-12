/**
 * READ-ONLY. Title & Escrow investigation, part 5: diff our payload against the
 * legacy PCT order-entry app's claimed CreateOrder shape.
 *
 * Reads only. No SoftPro writes. Sections:
 *   A  vendor_api_logs response messages for all 15 createOrder attempts
 *   B  officer roster from `contacts` — can LookUpCodeTitleOffice and TitleOffice
 *      diverge, and how often
 *   C  GetLookuptable('Title Officer' / 'Escrow Officer') — the one-row feed that
 *      carries branch + PCT\username together
 *   D  GetOrderMarketingRep — is "OrangeCountyHouseAccount" a real sales-rep code
 *   E  GetOrderDetails on real PRV Title & Escrow files — which namespace does
 *      SoftPro store for the escrow officer
 */
import postgres from 'postgres';
import {
  getLookupTable,
  getSalesReps,
  getOrderDetails,
  getOrderContacts,
} from '../../src/lib/integrations/softpro/client';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

const LOG_IDS = [1077788, 1077673, 1077398, 1077352, 152, 149, 146, 188, 164];
const PRV_TE_FILES = ['20021428-PRV', '20021320-PRV', '20021309-PRV', '20021227-PRV'];

function head(title: string): void {
  console.log('');
  console.log('='.repeat(110));
  console.log(title);
  console.log('='.repeat(110));
}

function j(v: unknown, n = 400): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return (s ?? 'null').slice(0, n);
}

(async () => {
  // ── A. every createOrder attempt + what SoftPro said back ──────────────────
  head('A. ALL createOrder ATTEMPTS — response_meta');
  const attempts = await sql.unsafe(`
    select id, created_at, success, http_status,
           response_meta->>'status'  as body_status,
           response_meta->>'message' as message,
           request_meta->'payload'->'baseDetails'->>'OrderType' as order_type,
           request_meta->'payload'->'transactionDetails'->>'LookUpCodeTitleOffice' as branch,
           request_meta->'payload' ? 'orderType' as has_top_level_ordertype
      from vendor_api_logs
     where vendor = 'softpro' and operation = 'create_order'
     order by id
  `);
  console.log(
    'id'.padEnd(10), 'ok'.padEnd(6), 'http'.padEnd(6), 'body'.padEnd(6),
    'orderType'.padEnd(16), 'branch'.padEnd(8), 'topLvl?'.padEnd(8), 'message',
  );
  console.log('-'.repeat(110));
  for (const r of attempts as unknown as Record<string, unknown>[]) {
    console.log(
      String(r.id).padEnd(10),
      String(r.success).padEnd(6),
      String(r.http_status ?? '').padEnd(6),
      String(r.body_status ?? '').padEnd(6),
      String(r.order_type ?? '').padEnd(16),
      String(r.branch ?? '').padEnd(8),
      String(r.has_top_level_ordertype).padEnd(8),
      j(r.message, 220),
    );
  }
  console.log(`\ntotal createOrder attempts ever: ${(attempts as unknown[]).length}`);

  head('A2. FULL rawBody of the two August Title & Escrow rejections');
  const raws = await sql.unsafe(`
    select id, response_meta from vendor_api_logs where id in (1077788, 1077673) order by id
  `);
  for (const r of raws as unknown as Array<{ id: number; response_meta: unknown }>) {
    console.log(`--- id ${r.id} ---`);
    console.log(j(r.response_meta, 3000));
  }

  head('A3. Top-level key sets actually sent (from the log)');
  const keysets = await sql.unsafe(`
    select id, (select string_agg(k, ', ' order by k)
                from jsonb_object_keys(request_meta->'payload') k) as top_keys
      from vendor_api_logs
     where id in (${LOG_IDS.join(',')})
     order by id
  `);
  for (const r of keysets as unknown as Record<string, unknown>[]) {
    console.log(String(r.id).padEnd(10), String(r.top_keys));
  }

  // ── B. officer roster — title/escrow pair consistency ─────────────────────
  head('B. OFFICER ROSTER from `contacts` (what resolveBranchCode / resolveTitleExaminerLookup read)');
  const officers = await sql.unsafe(`
    select id, full_name, officer_name, lookup_code, office_lookup_code,
           softpro_lookup_code, closer_examiner,
           is_title_officer, is_escrow_officer, type, softpro_user_type
      from contacts
     where is_title_officer = true or is_escrow_officer = true
     order by is_title_officer desc, is_escrow_officer desc, id
  `);
  console.log(
    'id'.padEnd(8), 'name'.padEnd(24), 'TO'.padEnd(4), 'EO'.padEnd(4),
    'lookup_code'.padEnd(14), 'office_lookup'.padEnd(14), 'softpro_lookup_code',
  );
  console.log('-'.repeat(110));
  const titleOfficers: Array<{ name: string; office: string; examiner: string }> = [];
  const escrowOfficers: Array<{ name: string; office: string; examiner: string }> = [];
  for (const r of officers as unknown as Record<string, unknown>[]) {
    const name = String(r.officer_name ?? r.full_name ?? '');
    const office = String(r.office_lookup_code ?? '');
    const examiner = String(r.softpro_lookup_code ?? r.closer_examiner ?? '');
    console.log(
      String(r.id).padEnd(8),
      name.slice(0, 23).padEnd(24),
      (r.is_title_officer ? 'yes' : '').padEnd(4),
      (r.is_escrow_officer ? 'yes' : '').padEnd(4),
      String(r.lookup_code ?? '').padEnd(14),
      office.padEnd(14),
      examiner,
    );
    if (r.is_title_officer) titleOfficers.push({ name, office, examiner });
    if (r.is_escrow_officer) escrowOfficers.push({ name, office, examiner });
  }

  head('B2. T&E PAIR MATRIX — LookUpCodeTitleOffice (escrow officer branch) vs TitleOffice (title officer username)');
  console.log('On a Title & Escrow order resolveBranchCode uses the ESCROW officer and');
  console.log('resolveTitleExaminerLookup uses the TITLE officer. Cell = consistent? (branches equal)');
  console.log('');
  let consistent = 0;
  let inconsistent = 0;
  console.log('escrow officer'.padEnd(24), 'branch'.padEnd(8), '| title officers whose own office == that branch');
  console.log('-'.repeat(110));
  for (const eo of escrowOfficers) {
    const ok = titleOfficers.filter((t) => t.office && eo.office && t.office === eo.office);
    const bad = titleOfficers.filter((t) => !(t.office && eo.office && t.office === eo.office));
    consistent += ok.length;
    inconsistent += bad.length;
    console.log(
      eo.name.slice(0, 23).padEnd(24),
      (eo.office || '(none)').padEnd(8),
      `| ${ok.length}/${titleOfficers.length} consistent — ${ok.map((t) => `${t.examiner}(${t.office})`).join(', ') || 'NONE'}`,
    );
  }
  console.log('');
  console.log(`pairs total       : ${consistent + inconsistent}`);
  console.log(`pairs consistent  : ${consistent}`);
  console.log(`pairs INCONSISTENT: ${inconsistent}`);

  // ── C. the vendor's own title/escrow officer feed ─────────────────────────
  head('C. GetLookuptable — Title Officer feed (branch + PCT\\username on ONE row)');
  const to = await getLookupTable('Title Officer');
  if (!to.success || !Array.isArray(to.data)) {
    console.log(`READ FAILED: ${to.error?.message}`);
  } else {
    const rows = to.data as Array<Record<string, string>>;
    console.log(`rows: ${rows.length}`);
    console.log(`keys on row 0: ${Object.keys(rows[0] ?? {}).join(' | ')}`);
    console.log('');
    for (const r of rows) {
      console.log(
        String(r['Title officer/Examiner'] ?? '').padEnd(22),
        String(r['Office LookupCode'] ?? '').padEnd(10),
        String(r['Officer Name'] ?? '').padEnd(28),
        String(r['Email'] ?? ''),
      );
    }
  }

  head('C2. GetLookuptable — Escrow Officer feed');
  const eo = await getLookupTable('Escrow Officer');
  if (!eo.success || !Array.isArray(eo.data)) {
    console.log(`READ FAILED: ${eo.error?.message}`);
  } else {
    const rows = eo.data as Array<Record<string, string>>;
    console.log(`rows: ${rows.length}`);
    console.log(`keys on row 0: ${Object.keys(rows[0] ?? {}).join(' | ')}`);
    console.log('');
    for (const r of rows) {
      console.log(
        String(r['Escrow officer/Closer'] ?? '').padEnd(22),
        String(r['Office LookupCode'] ?? '').padEnd(10),
        String(r['Officer Name'] ?? '').padEnd(28),
        String(r['Email'] ?? ''),
      );
    }
  }

  // ── D. sales reps ─────────────────────────────────────────────────────────
  head('D. GetOrderMarketingRep — is "OrangeCountyHouseAccount" a valid sales-rep lookup code?');
  const reps = await getSalesReps();
  if (!reps.success || !Array.isArray(reps.data)) {
    console.log(`READ FAILED: ${reps.error?.message}`);
  } else {
    const rows = reps.data as Array<Record<string, string>>;
    console.log(`rows: ${rows.length}`);
    console.log(`keys on row 0: ${Object.keys(rows[0] ?? {}).join(' | ')}`);
    const NEEDLES = ['OrangeCountyHouseAccount', 'PCT\\jnouri', 'PCT\\awu', 'PCT\\ghernandez', 'PCT\\ccota'];
    for (const needle of NEEDLES) {
      const hit = rows.filter((r) => Object.values(r).some((v) => String(v).trim() === needle));
      console.log(`\n  "${needle}" -> ${hit.length} row(s)`);
      for (const h of hit.slice(0, 3)) console.log(`     ${j(h, 300)}`);
    }
    const houseish = rows.filter((r) => Object.values(r).some((v) => /house\s*account/i.test(String(v))));
    console.log(`\n  rows matching /house ?account/i: ${houseish.length}`);
    for (const h of houseish.slice(0, 10)) console.log(`     ${j(h, 300)}`);
  }

  head('D2. what the hub stores for the sales reps sent on each attempt');
  const repRows = await sql.unsafe(`
    select id, full_name, lookup_code, softpro_lookup_code, is_sales_rep, email
      from contacts
     where lookup_code in ('OrangeCountyHouseAccount')
        or softpro_lookup_code in ('OrangeCountyHouseAccount','PCT\\jnouri','PCT\\awu','PCT\\ghernandez')
        or lookup_code in ('PCT\\jnouri','PCT\\awu','PCT\\ghernandez')
     order by id
  `);
  for (const r of repRows as unknown as Record<string, unknown>[]) {
    console.log(
      String(r.id).padEnd(8),
      String(r.full_name ?? '').slice(0, 26).padEnd(28),
      String(r.lookup_code ?? '').padEnd(28),
      String(r.softpro_lookup_code ?? '').padEnd(20),
      String(r.is_sales_rep ?? ''),
    );
  }

  // ── E. namespaces on real PRV Title & Escrow orders ───────────────────────
  head('E. REAL PRV Title & Escrow orders — escrow officer namespace');
  console.log('GetOrderDetails.EscrowOfficerContact.LookupCode  vs  GetOrderContacts.EscrowCompanies.Person.LookupCode');
  console.log('');
  console.log(
    'file'.padEnd(16), 'Details.EscrowOfficer'.padEnd(24), 'Details.EOContact.Lookup'.padEnd(26),
    'Contacts.Person.Lookup'.padEnd(20), 'Details.TOContact.Lookup',
  );
  console.log('-'.repeat(115));
  for (const f of PRV_TE_FILES) {
    const det = await getOrderDetails({ dateFrom: '2026-07-01', dateTo: '2026-09-01', orderNumber: f });
    const rows = (Array.isArray(det.data) ? det.data : []) as unknown as Record<string, unknown>[];
    const rec = rows.find((r) => String(r.OrderNumber ?? '').trim() === f) ?? rows[0];
    const eoc = (rec?.EscrowOfficerContact ?? null) as Record<string, unknown> | null;
    const toc = (rec?.TitleOfficerContact ?? null) as Record<string, unknown> | null;

    const con = await getOrderContacts(f);
    const cd = (con.data ?? {}) as Record<string, { Person?: { LookupCode?: string } | null } | null>;

    console.log(
      f.padEnd(16),
      String(rec?.EscrowOfficer ?? '(none)').slice(0, 23).padEnd(24),
      String(eoc?.LookupCode ?? '(none)').padEnd(26),
      String(cd.EscrowCompanies?.Person?.LookupCode ?? '(none)').padEnd(20),
      String(toc?.LookupCode ?? '(none)'),
    );
  }

  head('E2. raw EscrowOfficerContact / TitleOfficerContact on one PRV file');
  const one = await getOrderDetails({ dateFrom: '2026-07-01', dateTo: '2026-09-01', orderNumber: PRV_TE_FILES[0]! });
  const oneRows = (Array.isArray(one.data) ? one.data : []) as unknown as Record<string, unknown>[];
  const oneRec = oneRows.find((r) => String(r.OrderNumber ?? '').trim() === PRV_TE_FILES[0]) ?? oneRows[0];
  console.log(`OrderNumber            : ${String(oneRec?.OrderNumber ?? '')}`);
  console.log(`OrderType              : ${String(oneRec?.OrderType ?? '')}`);
  console.log(`ProductType            : ${String(oneRec?.ProductType ?? '')}`);
  console.log(`TransactionType        : ${String(oneRec?.TransactionType ?? '')}`);
  console.log(`MarketingRep           : ${String(oneRec?.MarketingRep ?? '')}`);
  console.log(`SalesRepContact        : ${j((oneRec as Record<string, unknown>)?.SalesRepContact)}`);
  console.log(`TitleOfficer           : ${String(oneRec?.TitleOfficer ?? '')}`);
  console.log(`TitleOfficerContact    : ${j(oneRec?.TitleOfficerContact)}`);
  console.log(`EscrowOfficer          : ${String(oneRec?.EscrowOfficer ?? '')}`);
  console.log(`EscrowOfficerContact   : ${j(oneRec?.EscrowOfficerContact)}`);
  console.log(`all keys               : ${Object.keys(oneRec ?? {}).join(', ')}`);

  await sql.end();
  process.exit(0);
})();
