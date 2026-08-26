/**
 * THE FOURTH COLUMN — what actually landed in SoftPro.
 *
 * READ-ONLY. Two GET endpoints only: GetOrderDetails and GetOrderContacts.
 * Nothing here calls createOrder, updateOrder, AddNotes or any other mutating
 * operation.
 *
 * FIELD NAMES COME FROM A REAL RESPONSE, not from the create payload. Those two
 * vocabularies do not match, and assuming they did made the first version of
 * this script report five fields as "dropped" that SoftPro was returning under
 * different names:
 *
 *   create payload      GetOrderDetails      GetOrderContacts
 *   Address1        ->  Address
 *   Product         ->  ProductType
 *   SalesAmount     ->  SalesPrice
 *   Country(=county)->  Country
 *   PrimaryBorrower->   buyer.Person.PrimaryBorrower   (two levels down)
 *
 * Verified with scripts/audit/dump-shape.ts against a live order.
 *
 * ALSO IMPORTANT: GetOrderDetails returns NO apn, legal description or property
 * type field at all. Their absence is therefore NOT evidence that the write
 * dropped them — it is evidence that this endpoint cannot answer the question.
 * Those are marked "unverifiable" rather than "dropped".
 */
import postgres from 'postgres';
import { getOrderDetails, getOrderContacts } from '../../src/lib/integrations/softpro/client';

const LIMIT = Number(process.argv[2] ?? 10);
const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();
const has = (v: unknown): boolean => s(v) !== '';

/** Dotted path lookup, case-insensitive at each hop. */
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

/** First non-empty of several paths. */
function firstAt(root: unknown, ...paths: string[]): string {
  for (const p of paths) { const v = at(root, p); if (v) return v; }
  return '';
}

type Verdict = 'match' | 'partial' | 'differs' | 'dropped' | 'softpro only' | 'both empty' | 'unverifiable' | 'not captured';

interface Row { label: string; local: string; softpro: string; unverifiable?: boolean; notCaptured?: boolean; numeric?: boolean }

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

function verdict(r: Row): Verdict {
  if (r.notCaptured) return 'not captured';
  if (r.unverifiable) return 'unverifiable';
  if (!has(r.local) && !has(r.softpro)) return 'both empty';
  if (has(r.local) && !has(r.softpro)) return 'dropped';
  if (!has(r.local) && has(r.softpro)) return 'softpro only';
  const a = norm(r.local); const b = norm(r.softpro);
  if (a === b) return 'match';
  // Numeric equality ONLY for fields that are numbers. Applying it generally
  // made "31195 EMERY CT" and "31195 Emery City" compare equal — both reduce to
  // 31195 — which hid a real address corruption behind a green "match".
  if (r.numeric) {
    const na = Number(r.local.replace(/[^0-9.-]/g, ''));
    const nb = Number(r.softpro.replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(na) && Number.isFinite(nb) && na === nb) return 'match';
  }
  if (b.includes(a) || a.includes(b)) return 'partial';
  return 'differs';
}

const LOUD: Verdict[] = ['dropped', 'differs'];

(async () => {
  const locals = await sql.unsafe(`
    select o.id, o.file_number, o.opened_at, o.transaction_type, o.order_type,
           o.product_type, o.sales_price, o.loan_amount,
           o.sales_rep_id, o.title_officer_id, o.escrow_officer_id, o.client_contact_id,
           sr.full_name as sales_rep_name, tofc.full_name as title_officer_name,
           p.address, p.city, p.state, p.zip, p.county, p.apn, p.legal_description,
           p.property_type, p.full_address,
           (select json_agg(json_build_object(
              'role', pt.role, 'name', pt.external_name, 'company', pt.external_company,
              'email', pt.external_email, 'phone', pt.external_phone))
            from order_parties pt where pt.order_id = o.id) as parties
    from orders o
    left join order_properties p on p.order_id = o.id
    left join contacts sr on sr.id = o.sales_rep_id
    left join contacts tofc on tofc.id = o.title_officer_id
    where o.source = 'manual_entry'
    order by o.opened_at desc
    limit ${LIMIT}`);

  console.log(`hub-created orders sampled: ${locals.length}  (source='manual_entry')\n`);

  const tally = new Map<string, Record<Verdict, number>>();
  const blank = (): Record<Verdict, number> => ({
    match: 0, partial: 0, differs: 0, dropped: 0, 'softpro only': 0,
    'both empty': 0, unverifiable: 0, 'not captured': 0,
  });

  for (const L of locals) {
    const fn = String(L.file_number);
    const day = new Date(L.opened_at as Date).toISOString().slice(0, 10);

    const [detRes, conRes] = await Promise.all([
      getOrderDetails({ dateFrom: day, dateTo: day, orderNumber: fn, orderId: Number(L.id) }),
      getOrderContacts(fn),
    ]);

    const detArr = (detRes.success && Array.isArray(detRes.data) ? detRes.data : []) as unknown[];
    const det = (detArr[0] ?? null) as Record<string, unknown> | null;
    const con = (conRes.success ? conRes.data : null) as Record<string, unknown> | null;

    console.log('═'.repeat(96));
    console.log(`${fn}   opened ${day}   local id ${L.id}   ${s(L.transaction_type) || '(no tx type)'}`);
    if (!detRes.success) console.log(`  !! GetOrderDetails failed: ${detRes.error?.message}`);
    if (!conRes.success) console.log(`  !! GetOrderContacts failed: ${conRes.error?.message}`);
    if (detRes.success && !det) {
      console.log('  !! SoftPro returned NO detail record for this order number on its own opened date');
    }

    const rows: Row[] = [
      { label: 'property.address', local: s(L.address), softpro: at(det, 'Address') },
      { label: 'property.city', local: s(L.city), softpro: at(det, 'City') },
      { label: 'property.state', local: s(L.state), softpro: at(det, 'State') },
      { label: 'property.zip', local: s(L.zip), softpro: at(det, 'Zip') },
      // SoftPro spells the county field "Country" on both write and read.
      { label: 'property.county', local: s(L.county), softpro: at(det, 'Country') },
      // No field exists on this endpoint — absence proves nothing either way.
      { label: 'property.apn', local: s(L.apn), softpro: '', unverifiable: true },
      { label: 'property.legal', local: s(L.legal_description), softpro: '', unverifiable: true },
      { label: 'property.type', local: s(L.property_type), softpro: '', unverifiable: true },
      { label: 'txn.type', local: s(L.transaction_type), softpro: at(det, 'TransactionType') },
      { label: 'txn.product', local: s(L.product_type), softpro: at(det, 'ProductType') },
      { label: 'txn.orderType', local: s(L.order_type), softpro: at(det, 'OrderType') },
      { label: 'txn.salesPrice', local: s(L.sales_price), softpro: at(det, 'SalesPrice'), numeric: true },
      { label: 'txn.loanAmount', local: s(L.loan_amount), softpro: at(det, 'LoanAmount'), numeric: true },
      { label: 'assign.titleOfficer', local: s(L.title_officer_name), softpro: at(det, 'TitleOfficer') },
      { label: 'assign.salesRep', local: s(L.sales_rep_name), softpro: at(det, 'MarketingRep') },
    ];

    const parties = (L.parties ?? []) as Array<Record<string, unknown>>;
    const localBy = (role: string) => parties.find((p) => s(p.role) === role);
    const partyRow = (localRole: string, label: string, ...paths: string[]): Row => {
      const lp = localBy(localRole);
      return {
        label: `party.${label}`,
        local: s(lp?.name) || s(lp?.company),
        softpro: firstAt(con, ...paths),
      };
    };

    rows.push(
      partyRow('buyer', 'buyer/borrower', 'buyer.Person.PrimaryBorrower', 'buyer.Person.Name'),
      partyRow('seller', 'seller', 'Sellers.Person.PrimaryOwner', 'Sellers.Person.Name'),
      partyRow('lender', 'lender', 'Lenders.Company.Name', 'Lenders.Person.Name'),
      partyRow('escrow_company', 'escrow company', 'EscrowCompanies.Company.Name', 'EscrowCompanies.Person.Name'),
      partyRow('listing_agent', 'listing agent', 'ListingAgentBrokers.Company.Name', 'ListingAgentBrokers.Person.Name'),
      partyRow('buyer_agent', "buyer's agent", 'ListingAgentBrokers.Company.Name', 'ListingAgentBrokers.Person.Name'),
    );
    rows.push({
      label: 'party.mortgage broker',
      local: '', softpro: firstAt(con, 'MortgageBrokers.Company.Name', 'MortgageBrokers.Person.Name'),
      notCaptured: true,
    });

    for (const r of rows) {
      const v = verdict(r);
      const t = tally.get(r.label) ?? blank();
      t[v]++; tally.set(r.label, t);
      const flag = LOUD.includes(v) ? `*** ${v.toUpperCase()} ***` : v;
      console.log(
        `  ${r.label.padEnd(22)} local=${(r.local || '—').slice(0, 30).padEnd(30)} ` +
        `softpro=${(r.softpro || '—').slice(0, 30).padEnd(30)} ${flag}`,
      );
    }
  }

  console.log('\n' + '═'.repeat(96));
  console.log(`TALLY over ${locals.length} hub-created orders\n`);
  const cols: Verdict[] = ['match', 'partial', 'differs', 'dropped', 'softpro only', 'both empty', 'unverifiable', 'not captured'];
  console.log(`  ${'field'.padEnd(22)}` + cols.map((c) => c.slice(0, 9).padStart(11)).join(''));
  const score = (t: Record<Verdict, number>) => t.dropped * 100 + t.differs * 10;
  for (const [label, t] of [...tally.entries()].sort((a, b) => score(b[1]) - score(a[1]))) {
    const mark = t.dropped > 0 ? '   <<< DROP' : t.differs > 0 ? '   <<< DIFF' : '';
    console.log(`  ${label.padEnd(22)}` + cols.map((c) => String(t[c]).padStart(11)).join('') + mark);
  }
  await sql.end();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
