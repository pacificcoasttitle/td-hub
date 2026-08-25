/**
 * READ-ONLY. Every field of today's four create_order payloads, flattened, with
 * three states distinguished — because "present" and "populated" are different
 * claims and the previous report conflated them:
 *
 *   ABSENT     the key does not exist in the payload
 *   EMPTY      the key exists and holds "" or null
 *   POPULATED  the key exists and holds a value
 *
 * Then a field-by-field diff of the two that succeeded against the two that
 * failed, including keys present in one group and absent in the other.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

type State = 'ABSENT' | 'EMPTY' | 'POPULATED';

function flatten(o: unknown, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (o === null || o === undefined) { out.set(prefix, o); return out; }
  if (Array.isArray(o)) {
    o.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  out.set(prefix, o);
  return out;
}

function state(m: Map<string, unknown>, key: string): State {
  if (!m.has(key)) return 'ABSENT';
  const v = m.get(key);
  if (v === null || v === undefined) return 'EMPTY';
  if (typeof v === 'string' && v.trim() === '') return 'EMPTY';
  return 'POPULATED';
}

const show = (m: Map<string, unknown>, key: string): string => {
  const st = state(m, key);
  if (st === 'ABSENT') return '(absent)';
  if (st === 'EMPTY') {
    const v = m.get(key);
    return v === null ? '(null)' : v === undefined ? '(undefined)' : '(empty string)';
  }
  return JSON.stringify(m.get(key));
};

(async () => {
  const rows = await sql.unsafe(`
    with pac as (select ((date_trunc('day', now() at time zone 'America/Los_Angeles') - interval '1 day') at time zone 'America/Los_Angeles') at time zone 'UTC' as t0)
    select v.id, v.created_at, v.success,
           v.response_meta->>'orderNumber' as order_number,
           v.request_meta->'payload' as payload
    from vendor_api_logs v, pac
    where v.vendor='softpro' and v.operation='create_order' and v.created_at >= pac.t0
    order by v.created_at asc`);

  const attempts = rows.map((r) => ({
    id: Number(r.id),
    when: new Date(r.created_at as Date),
    ok: r.success as boolean,
    on: r.order_number ? String(r.order_number) : null,
    flat: flatten(r.payload),
  }));

  console.log(`attempts: ${attempts.length}\n`);
  const label = (a: typeof attempts[number]) =>
    `${a.ok ? 'OK ' : 'FAIL'} ${a.on ?? '—'.padEnd(12)}`;

  // ── Part 1: the lookup-code question, answered precisely ─────────────────
  console.log('═'.repeat(104));
  console.log('LOOKUP CODES — present, or populated?');
  console.log('═'.repeat(104));
  const LOOKUP_KEYS = [
    'personalDetails.ClientLookupCode',
    'personalDetails.CompanyLookupCode',
    'personalDetails.SalesRep',
    'personalDetails.UserType',
    'transactionDetails.TitleOffice',
    'transactionDetails.LookUpCodeTitleOffice',
    'transactionDetails.LookUpCodeEscrowOfficer',
    'transactionDetails.EscrowOfficerName',
    'transactionDetails.UnderwriterLookUpCode',
  ];
  console.log(`  ${'field'.padEnd(46)}` + attempts.map((a) => label(a).padEnd(28)).join(''));
  for (const k of LOOKUP_KEYS) {
    console.log(`  ${k.padEnd(46)}` + attempts.map((a) => `${state(a.flat, k)}:${show(a.flat, k)}`.slice(0, 27).padEnd(28)).join(''));
  }

  // ── Part 2: full field-by-field diff, OK group vs FAIL group ─────────────
  const allKeys = new Set<string>();
  for (const a of attempts) for (const k of a.flat.keys()) allKeys.add(k);
  const ok = attempts.filter((a) => a.ok);
  const bad = attempts.filter((a) => !a.ok);

  console.log('\n' + '═'.repeat(104));
  console.log('EVERY FIELD — the two that succeeded vs the two that failed');
  console.log('═'.repeat(104));
  console.log(`  ${'field'.padEnd(46)}` + attempts.map((a) => label(a).padEnd(28)).join(''));
  const differing: string[] = [];
  for (const k of [...allKeys].sort()) {
    if (k === 'UserId') continue; // redacted at log time
    const cells = attempts.map((a) => `${show(a.flat, k)}`);
    const states = attempts.map((a) => state(a.flat, k));
    // A field is interesting when the OK group and the FAIL group disagree on
    // STATE, or when values differ in a way that is not just per-order data.
    const okStates = new Set(ok.map((a) => state(a.flat, k)));
    const badStates = new Set(bad.map((a) => state(a.flat, k)));
    const stateSplit = [...okStates].join('|') !== [...badStates].join('|');
    const mark = stateSplit ? '  <<< STATE DIFFERS' : '';
    if (stateSplit) differing.push(k);
    console.log(`  ${k.padEnd(46)}` + cells.map((c, i) => `${c}`.slice(0, 27).padEnd(28)).join('') + mark);
    void states;
  }

  console.log('\n' + '─'.repeat(104));
  console.log('KEYS WHOSE PRESENT/EMPTY/ABSENT STATE DIFFERS BETWEEN THE TWO GROUPS:');
  if (differing.length === 0) console.log('  (none — every field has the same state in both groups)');
  for (const k of differing) {
    console.log(`  ${k}`);
    for (const a of attempts) console.log(`      ${label(a)}  ${state(a.flat, k).padEnd(9)} ${show(a.flat, k)}`);
  }

  // ── Part 3: keys entirely absent from one group ──────────────────────────
  console.log('\n' + '─'.repeat(104));
  console.log('SECTIONS PRESENT PER ATTEMPT (top-level keys):');
  for (const a of attempts) {
    const top = new Set([...a.flat.keys()].map((k) => k.split(/[.[]/)[0]!));
    console.log(`  ${label(a)}  ${[...top].sort().join(', ')}`);
  }

  await sql.end();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
