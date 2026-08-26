/**
 * READ-ONLY. Did today's create attempts actually produce orders in SoftPro,
 * and does what SoftPro stored match what we sent?
 *
 * Three GETs only: GetOrderDetails, GetOrderContacts, GetOrders.
 *
 * Comparator carried over from e9cd128, including both of its corrections:
 *   - the create and read vocabularies differ, so every mapping below names
 *     BOTH keys explicitly (Address1->Address, Product->ProductType,
 *     SalesAmount->SalesPrice, borrower two levels down under buyer.Person);
 *   - numeric equality is applied ONLY to numeric fields. Applying it generally
 *     made "31195 EMERY CT" and "31195 Emery City" compare equal, because both
 *     reduce to 31195.
 */
import postgres from 'postgres';
import { getOrderDetails, getOrderContacts, getOrders } from '../../src/lib/integrations/softpro/client';

const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();
const has = (v: unknown): boolean => s(v) !== '';
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

function at(root: unknown, path: string): string {
  let cur: unknown = root;
  for (const seg of path.split('.')) {
    if (!cur || typeof cur !== 'object') return '';
    const rec = cur as Record<string, unknown>;
    const key = Object.keys(rec).find((k) => k.toLowerCase() === seg.toLowerCase());
    if (key === undefined) return '';
    cur = rec[key];
  }
  return s(cur);
}
const firstAt = (root: unknown, ...paths: string[]) => {
  for (const p of paths) { const v = at(root, p); if (v) return v; }
  return '';
};

type V = 'MATCH' | 'DIFFERS' | 'SENT-NOT-STORED' | 'STORED-NOT-SENT' | 'both empty' | 'unverifiable';

interface Row { field: string; sent: string; stored: string; numeric?: boolean; unverifiable?: boolean; note?: string }

function verdict(r: Row): V {
  if (r.unverifiable) return 'unverifiable';
  if (!has(r.sent) && !has(r.stored)) return 'both empty';
  if (has(r.sent) && !has(r.stored)) return 'SENT-NOT-STORED';
  if (!has(r.sent) && has(r.stored)) return 'STORED-NOT-SENT';
  if (norm(r.sent) === norm(r.stored)) return 'MATCH';
  if (r.numeric) {
    const a = Number(r.sent.replace(/[^0-9.-]/g, ''));
    const b = Number(r.stored.replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(a) && Number.isFinite(b) && a === b) return 'MATCH';
  }
  return 'DIFFERS';
}

(async () => {
  const attempts = await sql.unsafe(`
    with pac as (select ((date_trunc('day', now() at time zone 'America/Los_Angeles')) at time zone 'America/Los_Angeles') at time zone 'UTC' as t0)
    select v.id, v.created_at, v.success, v.response_meta, v.request_meta
    from vendor_api_logs v, pac
    where v.vendor='softpro' and v.operation='create_order' and v.created_at >= pac.t0
    order by v.created_at asc`);

  // ── 2 + 3. Existence, and whether a "failed" attempt created anything ──────
  console.log('═'.repeat(100));
  console.log('EXISTENCE CHECK');
  console.log('═'.repeat(100));

  const day = new Date().toISOString().slice(0, 10);
  const prevDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const listRes = await getOrders({ dateFrom: prevDay, dateTo: day });
  const list = (listRes.success && Array.isArray(listRes.data) ? listRes.data : []) as unknown as Array<Record<string, unknown>>;
  console.log(`GetOrders ${prevDay}..${day}: success=${listRes.success} records=${list.length}\n`);

  const created: Array<{ logId: number; orderNumber: string; sent: Record<string, unknown> }> = [];

  for (const a of attempts) {
    const resp = (a.response_meta ?? {}) as Record<string, unknown>;
    const sent = ((a.request_meta as Record<string, unknown>)?.payload ?? {}) as Record<string, unknown>;
    const on = s(resp.orderNumber);
    const addr = at(sent, 'propertyDetails.0.Address1') || s((sent.propertyDetails as unknown[])?.[0] && (((sent.propertyDetails as Record<string, unknown>[])[0])!).Address1);
    const stamp = (a.created_at as Date).toISOString();

    console.log(`log ${a.id}  ${stamp}  success=${a.success}  bodyStatus=${s(resp.status)}  orderNumber=${on || '(none returned)'}`);
    console.log(`   property sent: ${addr}`);

    if (on) {
      const det = await getOrderDetails({ dateFrom: day, dateTo: day, orderNumber: on });
      const rec = (det.success && Array.isArray(det.data) ? det.data[0] : null) as Record<string, unknown> | null;
      console.log(`   -> GetOrderDetails(${on}): ${rec ? 'ORDER EXISTS' : 'ORDER DOES NOT EXIST'}`);
      if (rec) created.push({ logId: Number(a.id), orderNumber: on, sent });
    } else {
      console.log('   -> no order number returned. Searching SoftPro\'s own order list for this address:');
      const hits = list.filter((o) => {
        const oa = firstAt(o, 'Address', 'Address1', 'PropertyAddress');
        return oa && norm(oa) === norm(addr);
      });
      if (hits.length === 0) {
        console.log('      NO ORDER in SoftPro carries this address — the create genuinely failed.');
      } else {
        console.log(`      *** ${hits.length} ORDER(S) IN SOFTPRO CARRY THIS ADDRESS ***`);
        for (const h of hits) {
          console.log(`         ${firstAt(h, 'OrderNumber')}  received=${firstAt(h, 'ReceivedDate')}  status=${firstAt(h, 'OrderStatus')}`);
        }
      }
    }
    console.log('');
  }

  // Duplicate check across the whole day list for every address we sent today.
  console.log('─'.repeat(100));
  console.log('DUPLICATE CHECK — every address we transmitted today, counted in SoftPro');
  const sentAddrs = new Map<string, number>();
  for (const a of attempts) {
    const sent = ((a.request_meta as Record<string, unknown>)?.payload ?? {}) as Record<string, unknown>;
    const addr = s(((sent.propertyDetails as Record<string, unknown>[]) ?? [])[0]?.Address1);
    if (addr) sentAddrs.set(addr, (sentAddrs.get(addr) ?? 0) + 1);
  }
  for (const [addr, attemptCount] of sentAddrs) {
    const hits = list.filter((o) => norm(firstAt(o, 'Address', 'Address1')) === norm(addr));
    console.log(`  ${addr.padEnd(24)} attempts=${attemptCount}  orders in SoftPro=${hits.length}` +
      (hits.length > 1 ? '   *** DUPLICATE ***' : ''));
    for (const h of hits) console.log(`      ${firstAt(h, 'OrderNumber')}  ${firstAt(h, 'ReceivedDate')}`);
  }

  // ── 4 + 5. Field by field for orders that exist ───────────────────────────
  for (const c of created) {
    const [detRes, conRes] = await Promise.all([
      getOrderDetails({ dateFrom: day, dateTo: day, orderNumber: c.orderNumber }),
      getOrderContacts(c.orderNumber),
    ]);
    const det = (detRes.success && Array.isArray(detRes.data) ? detRes.data[0] : null) as Record<string, unknown> | null;
    const con = (conRes.success ? conRes.data : null) as Record<string, unknown> | null;
    const P = (c.sent.propertyDetails as Record<string, unknown>[])?.[0] ?? {};
    const T = (c.sent.transactionDetails ?? {}) as Record<string, unknown>;
    const B = (c.sent.baseDetails ?? {}) as Record<string, unknown>;
    const PD = (c.sent.personalDetails ?? {}) as Record<string, unknown>;
    const SD = (c.sent.sellerDetails ?? {}) as Record<string, unknown>;

    const joinName = (f: unknown, m: unknown, l: unknown) => [s(f), s(m), s(l)].filter(Boolean).join(' ');

    const rows: Row[] = [
      { field: 'Address1 -> Address', sent: s(P.Address1), stored: at(det, 'Address') },
      { field: 'Address2 -> (none)', sent: s(P.Address2), stored: '', unverifiable: true, note: 'no field on GetOrderDetails' },
      { field: 'City -> City', sent: s(P.City), stored: at(det, 'City') },
      { field: 'State -> State', sent: s(P.State), stored: at(det, 'State') },
      { field: 'Zip -> Zip', sent: s(P.Zip), stored: at(det, 'Zip') },
      { field: 'Country(county) -> Country', sent: s(P.Country), stored: at(det, 'Country') },
      { field: 'APNNumberParcelID -> (none)', sent: s(P.APNNumberParcelID), stored: '', unverifiable: true, note: 'no field on GetOrderDetails' },
      { field: 'Description(legal) -> (none)', sent: s(P.Description), stored: '', unverifiable: true, note: 'no field on GetOrderDetails' },
      { field: 'TransactionType -> TransactionType', sent: s(T.TransactionType), stored: at(det, 'TransactionType') },
      { field: 'OrderType -> OrderType', sent: s(B.OrderType), stored: at(det, 'OrderType') },
      { field: 'Product -> ProductType', sent: s(T.Product), stored: at(det, 'ProductType') },
      { field: 'SalesAmount -> SalesPrice', sent: s(T.SalesAmount), stored: at(det, 'SalesPrice'), numeric: true },
      { field: 'LoanAmount -> LoanAmount', sent: s(T.LoanAmount), stored: at(det, 'LoanAmount'), numeric: true },
      { field: 'CoverageAmount -> (none)', sent: s(T.CoverageAmount), stored: '', unverifiable: true, note: 'no field on GetOrderDetails' },
      { field: 'EscrowNumber -> (none)', sent: s(T.EscrowNumber), stored: '', unverifiable: true, note: 'no field on GetOrderDetails' },
      { field: 'LoanNumber -> LoanNumber', sent: s(T.LoanNumber), stored: at(det, 'LoanNumber') },
      { field: 'SalesRep -> SalesRepContact.LookupCode', sent: s(PD.SalesRep), stored: at(det, 'SalesRepContact.LookupCode') },
      { field: 'TitleOffice -> TitleOfficerContact.LookupCode', sent: s(T.TitleOffice), stored: at(det, 'TitleOfficerContact.LookupCode') },
      { field: 'LookUpCodeTitleOffice -> TitleCompanies.Company.LookupCode', sent: s(T.LookUpCodeTitleOffice), stored: at(con, 'TitleCompanies.Company.LookupCode') },
      { field: 'LookUpCodeEscrowOfficer -> (contacts)', sent: s(T.LookUpCodeEscrowOfficer), stored: firstAt(con, 'EscrowOfficers.Person.LookupCode') },
      { field: 'EscrowOfficerName -> (contacts)', sent: s(T.EscrowOfficerName), stored: firstAt(con, 'EscrowOfficers.Person.Name') },
      { field: 'UnderwriterLookUpCode -> Underwriters.Company.LookupCode', sent: s(T.UnderwriterLookUpCode), stored: at(con, 'Underwriters.Company.LookupCode') },
      { field: 'PrimaryBorrower(F M L) -> buyer.Person.PrimaryBorrower', sent: joinName(T.PrimaryBorrowerFirstName, T.PrimaryBorrowerMiddleName, T.PrimaryBorrowerLastName), stored: at(con, 'buyer.Person.PrimaryBorrower') },
      { field: 'SecondaryBorrower(F M L) -> buyer.Person.SecondaryBorrower', sent: joinName(T.SecondaryBorrowerFirstName, T.SecondaryBorrowerMiddleName, T.SecondaryBorrowerLastName), stored: firstAt(con, 'buyer.Person.SecondaryBorrower') },
      { field: 'PrimaryOwner(F M L) -> Sellers.Person', sent: joinName(SD.PrimaryOwnerFirstName, SD.PrimaryOwnerMiddleName, SD.PrimaryOwnerLastName), stored: firstAt(con, 'Sellers.Person.PrimaryOwner', 'Sellers.Person.Name') },
      { field: 'personalDetails.CompanyLookupCode -> EscrowCompanies.Company.LookupCode', sent: s(PD.CompanyLookupCode), stored: at(con, 'EscrowCompanies.Company.LookupCode') },
      { field: 'personalDetails.ClientLookupCode -> EscrowCompanies.Person.LookupCode', sent: s(PD.ClientLookupCode), stored: at(con, 'EscrowCompanies.Person.LookupCode') },
      { field: 'personalDetails.CompanyName -> EscrowCompanies.Company.Name', sent: s(PD.CompanyName), stored: at(con, 'EscrowCompanies.Company.Name') },
      { field: 'personalDetails.Email -> EscrowCompanies.Person.Email', sent: s(PD.Email), stored: at(con, 'EscrowCompanies.Person.Email') },
      { field: 'personalDetails.Telephone -> EscrowCompanies.Person.Phone', sent: s(PD.Telephone), stored: at(con, 'EscrowCompanies.Person.Phone') },
    ];

    for (const [section, path] of [
      ['buyersAgentDetails', 'BuyersAgentBrokers'], ['listingAgentDetails', 'ListingAgentBrokers'],
      ['lenderDetails', 'Lenders'], ['escrowDetails', 'EscrowCompanies'], ['mortgageDetails', 'MortgageBrokers'],
    ] as const) {
      const sec = c.sent[section] as Record<string, unknown> | undefined;
      rows.push({
        field: `${section} -> ${path}`,
        sent: sec ? (s(sec.CompanyName) || s(sec.Name) || '(section present)') : '',
        stored: firstAt(con, `${path}.Company.Name`, `${path}.Person.Name`),
      });
    }

    console.log('\n' + '═'.repeat(100));
    console.log(`ORDER ${c.orderNumber}   (log ${c.logId})   SENT vs STORED`);
    console.log('═'.repeat(100));
    console.log(`  ${'field'.padEnd(62)} ${'sent'.padEnd(32)} ${'stored'.padEnd(32)} verdict`);
    for (const r of rows) {
      const v = verdict(r);
      console.log(
        `  ${r.field.padEnd(62)} ${(r.sent || '—').slice(0, 32).padEnd(32)} ` +
        `${(r.stored || '—').slice(0, 32).padEnd(32)} ${v}${r.note ? '  (' + r.note + ')' : ''}`,
      );
    }
  }

  await sql.end();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
