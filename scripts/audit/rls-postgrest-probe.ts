/**
 * Probes the PUBLIC PostgREST surface with the anon key — the exact credential
 * that ships in the browser bundle. Run before and after 0038; the diff on the
 * `party_wizard_links` read is the proof the hole closed.
 *
 * SAFETY
 *   Reads only, with two deliberate exceptions that cannot destroy data:
 *     - OPTIONS, to enumerate the verbs PostgREST actually offers
 *     - one DELETE against `party_submissions` (0 rows) filtered to
 *       id = -2147483647 (no such row can exist, the column is a serial)
 *   Both are there to answer "is a write authorised", not to perform one. No
 *   INSERT, no UPDATE, no unfiltered DELETE, and no RPC is ever called.
 *
 * The key is read from the environment and never printed.
 */
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const FIVE = [
  'party_wizard_links',
  'party_submissions',
  'concierge_profiles',
  'concierge_profile_comps',
  'concierge_profile_transfers',
];
const CONTROL = ['orders', 'contacts'];

const head = (s: string) => console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`);

function assertEnv() {
  if (!BASE || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set');
  const parts = KEY.split('.');
  console.log(`anon key: present, ${KEY.length} chars, ${parts.length === 3 ? 'JWT (3 segments)' : 'not a JWT'}`);
  if (parts.length === 3) {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    // role/iss/exp only — no signature, no secret material.
    console.log(`anon key claims: role=${payload.role} iss=${payload.iss} exp=${payload.exp}`);
  }
  console.log(`project url host: ${new URL(BASE).host}`);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function readTable(table: string) {
  const res = await fetch(`${BASE}/rest/v1/${table}?select=*&limit=5`, {
    headers: { ...H, Prefer: 'count=exact' },
  });
  const range = res.headers.get('content-range');
  let n: number | string = 'n/a';
  let body = '';
  try {
    const j = await res.json();
    if (Array.isArray(j)) n = j.length;
    else body = JSON.stringify(j);
  } catch { /* non-json */ }
  return { table, status: res.status, rowsReturned: n, contentRange: range ?? '', error: body };
}

async function main() {
  assertEnv();

  head('1. ANONYMOUS READ of the five (the exposure) + two controls closed by 0032');
  const rows = [];
  for (const t of [...FIVE, ...CONTROL]) rows.push(await readTable(t));
  console.table(rows);
  const leak = rows.filter((r) => r.status === 200 && typeof r.rowsReturned === 'number' && r.rowsReturned > 0);
  console.log(leak.length
    ? `LEAKING (HTTP 200 with rows): ${leak.map((r) => `${r.table}(${r.rowsReturned})`).join(', ')}`
    : 'NO TABLE RETURNED ANY ROW TO THE ANON KEY');

  head('2. WHICH HTTP VERBS DOES PostgREST OFFER? (OPTIONS — is there a TRUNCATE verb?)');
  for (const t of ['party_wizard_links', 'party_submissions']) {
    const res = await fetch(`${BASE}/rest/v1/${t}`, { method: 'OPTIONS', headers: H });
    console.log(`${t.padEnd(22)} status=${res.status}  Allow: ${res.headers.get('allow') ?? '(none)'}`);
  }

  head('3. IS THERE A TRUNCATE METHOD AT ALL? (expect 405/501 — not a real verb)');
  for (const method of ['TRUNCATE', 'PURGE']) {
    try {
      const res = await fetch(`${BASE}/rest/v1/party_submissions`, { method, headers: H });
      console.log(`${method.padEnd(10)} -> HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    } catch (e) {
      console.log(`${method.padEnd(10)} -> rejected by the HTTP client: ${e instanceof Error ? e.message : e}`);
    }
  }

  head('4. RPC SURFACE AS anon SEES IT (OpenAPI root — enumerated, nothing called)');
  const spec = await fetch(`${BASE}/rest/v1/`, { headers: H });
  console.log(`GET /rest/v1/ -> HTTP ${spec.status}`);
  if (spec.ok) {
    const j = await spec.json() as { paths?: Record<string, unknown>; definitions?: Record<string, unknown> };
    const paths = Object.keys(j.paths ?? {});
    const rpcs = paths.filter((p) => p.startsWith('/rpc/'));
    const tables = paths.filter((p) => p !== '/' && !p.startsWith('/rpc/'));
    console.log(`tables exposed to anon (${tables.length}): ${tables.join(', ')}`);
    console.log(`RPC endpoints exposed to anon (${rpcs.length}): ${rpcs.length ? rpcs.join(', ') : '(none)'}`);
  } else {
    console.log((await spec.text()).slice(0, 300));
  }

  head('5. IS anon DELETE AUTHORISED? — filter matches nothing, on the empty table');
  const target = 'party_submissions';
  const probe = await fetch(`${BASE}/rest/v1/${target}?id=eq.-2147483647`, {
    method: 'DELETE',
    headers: { ...H, Prefer: 'return=representation,count=exact' },
  });
  const probeBody = await probe.text();
  console.log(`DELETE /${target}?id=eq.-2147483647 -> HTTP ${probe.status}`);
  console.log(`  Content-Range: ${probe.headers.get('content-range') ?? '(none)'}`);
  console.log(`  body: ${probeBody.slice(0, 300) || '(empty)'}`);
  console.log(probe.status === 401 || probe.status === 403
    ? '  => anon DELETE is REFUSED at this layer'
    : '  => anon DELETE is ACCEPTED (privilege granted); what limits it is RLS, nothing else');

  head('6. AUTH ENDPOINT — is the anon key a live gateway credential?');
  const settings = await fetch(`${BASE}/auth/v1/settings`, { headers: H });
  console.log(`GET /auth/v1/settings -> HTTP ${settings.status} (200 = the key is live and accepted)`);

  head('7. CAN THE anon ROLE OPEN A POSTGRES SESSION AT ALL?');
  console.log('answered from pg_roles in rls-facts.ts: anon.rolcanlogin = false.');
  console.log('The anon key is a gateway JWT, not a database password. There is no libpq path');
  console.log('for it, so the TRUNCATE privilege can only be exercised through a gateway that');
  console.log('offers TRUNCATE — see sections 2, 3 and 4 for whether one does.');
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
