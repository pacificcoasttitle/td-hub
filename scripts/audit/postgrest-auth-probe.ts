/**
 * Measures what the outside world can see, before and after a privilege revoke.
 *
 * Three questions, all of them the ones that could go wrong:
 *   1. Does PostgREST still build its schema cache, and does the OpenAPI document
 *      still enumerate the tables? (introspection)
 *   2. What does an anon read/write get: an authorisation error, or a 500 / a
 *      broken schema? (the difference between "denied" and "broken")
 *   3. Does GoTrue still answer, and can it still reach auth.users? (login)
 *
 * Read-only over HTTP apart from one deliberately unsatisfiable anon write
 * against the throwaway probe table. No real table is written to. No key value is
 * ever printed — only its presence, length class, and the decoded `role` claim.
 */
import { config } from 'dotenv';

config({ path: 'C:/Users/gerar/Desktop/TransactionDeskV2/td-hub/.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROBE = 'zz_privilege_probe';

if (!SUPABASE_URL || !ANON) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required');
  process.exit(1);
}

/** Decodes only the `role` claim so the report can say which key was used without printing it. */
function claimRole(jwt: string | undefined): string {
  if (!jwt) return 'absent';
  const parts = jwt.split('.');
  if (parts.length !== 3) return 'not-a-jwt';
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      role?: string;
    };
    return payload.role ?? 'no-role-claim';
  } catch {
    return 'undecodable';
  }
}

function short(body: string, n = 220) {
  const one = body.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

async function call(
  label: string,
  url: string,
  init: RequestInit & { key?: string } = {}
): Promise<{ status: number; body: string }> {
  const { key = ANON!, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('apikey', key);
  headers.set('Authorization', `Bearer ${key}`);
  let status = -1;
  let body = '';
  try {
    const res = await fetch(url, { ...rest, headers });
    status = res.status;
    body = await res.text();
  } catch (err) {
    body = `FETCH THREW: ${err instanceof Error ? err.message : String(err)}`;
  }
  console.log(`  ${label}\n    HTTP ${status}  ${short(body)}`);
  return { status, body };
}

async function postgrestIntrospection() {
  console.log('=== PostgREST introspection (OpenAPI document) ===');
  // This project refuses the root OpenAPI endpoint to the anon key ("Only the
  // service_role API key can be used for this endpoint"), so the document itself
  // has to be fetched with the service key. Recorded as a baseline fact, not a
  // change: it is the same answer before and after the revoke.
  await call('GET /rest/v1/ with anon key', `${SUPABASE_URL}/rest/v1/`, {
    headers: { Accept: 'application/openapi+json' },
  });
  const key = SERVICE ?? ANON!;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  });
  const text = await res.text();
  console.log(`  GET /rest/v1/ (service key)  ->  HTTP ${res.status}  ${text.length} bytes`);
  if (res.status !== 200) {
    console.log(`    body: ${short(text)}`);
    return;
  }
  let doc: { paths?: Record<string, unknown>; definitions?: Record<string, unknown> };
  try {
    doc = JSON.parse(text);
  } catch {
    console.log('    SCHEMA CACHE DID NOT PARSE AS JSON — this is the broken shape');
    return;
  }
  const paths = Object.keys(doc.paths ?? {});
  const defs = Object.keys(doc.definitions ?? {});
  console.log(`    paths: ${paths.length}   definitions: ${defs.length}`);
  console.log(`    probe table in paths: ${paths.includes(`/${PROBE}`)}`);
  console.log(`    probe table in definitions: ${defs.includes(PROBE)}`);
  for (const t of ['orders', 'contacts', 'party_wizard_links', 'profiles']) {
    console.log(`    ${t} in definitions: ${defs.includes(t)}`);
  }
}

async function postgrestAccess() {
  console.log('\n=== PostgREST access as anon ===');
  await call(`GET /rest/v1/${PROBE}?select=*`, `${SUPABASE_URL}/rest/v1/${PROBE}?select=*`);
  await call('GET /rest/v1/orders?select=id&limit=1', `${SUPABASE_URL}/rest/v1/orders?select=id&limit=1`);
  await call(
    'GET /rest/v1/party_wizard_links?select=id&limit=1',
    `${SUPABASE_URL}/rest/v1/party_wizard_links?select=id&limit=1`
  );
  // Deliberately unsatisfiable: primary key 0 on an empty throwaway table. Whether
  // it is refused for lack of privilege or refused by RLS, nothing is created.
  await call(`POST /rest/v1/${PROBE} (anon insert)`, `${SUPABASE_URL}/rest/v1/${PROBE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ id: 0, note: 'probe' }),
  });
  // Matches no rows by construction: id 0 is never present in an empty table.
  await call(
    `DELETE /rest/v1/${PROBE}?id=eq.0 (anon delete, matches nothing)`,
    `${SUPABASE_URL}/rest/v1/${PROBE}?id=eq.0`,
    { method: 'DELETE' }
  );
  // The exact request 0038 recorded as HTTP 200 (authorised) against a real table.
  // The filter cannot match: no id is ever -2147483647. Only the verb is under
  // test, and after the revoke it should be refused before any row is considered.
  await call(
    'DELETE /rest/v1/party_submissions?id=eq.-2147483647 (real table, matches nothing)',
    `${SUPABASE_URL}/rest/v1/party_submissions?id=eq.-2147483647`,
    { method: 'DELETE' }
  );
}

async function authProbe() {
  console.log('\n=== GoTrue / login path ===');
  console.log(`  anon key role claim: ${claimRole(ANON)}   service key present: ${SERVICE ? 'yes' : 'no'} (role claim: ${claimRole(SERVICE)})`);
  await call('GET /auth/v1/health', `${SUPABASE_URL}/auth/v1/health`);
  await call('GET /auth/v1/settings', `${SUPABASE_URL}/auth/v1/settings`);
  // Password grant against an address that cannot exist. Exercises the full
  // GoTrue -> auth.users query path and returns the standard rejection. It cannot
  // affect, lock out, or even touch a real account.
  await call(
    'POST /auth/v1/token?grant_type=password (nonexistent address)',
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'zz-privilege-probe-does-not-exist@example.invalid',
        password: 'not-a-real-password-' + Math.random().toString(36).slice(2),
      }),
    }
  );
  if (SERVICE) {
    // Read-only admin listing: proves GoTrue can SELECT auth.users right now.
    // Only the shape is printed — the response body carries real user addresses.
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
      const json = (await res.json()) as { users?: unknown[] };
      console.log(
        `  GET /auth/v1/admin/users?per_page=1 (service role, read-only)\n    HTTP ${res.status}  users returned: ${json.users?.length ?? 'n/a'} (bodies withheld: real addresses)`
      );
    } catch (err) {
      console.log(`  GET /auth/v1/admin/users -> THREW ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function deployedApp() {
  console.log('\n=== deployed app (GET only) ===');
  for (const path of ['/', '/login', '/orders']) {
    try {
      const res = await fetch(`https://td-hub.vercel.app${path}`, { redirect: 'manual' });
      const loc = res.headers.get('location');
      console.log(`  GET ${path} -> HTTP ${res.status}${loc ? ` -> ${loc}` : ''}`);
    } catch (err) {
      console.log(`  GET ${path} -> THREW ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

(async () => {
  await postgrestIntrospection();
  await postgrestAccess();
  await authProbe();
  await deployedApp();
})().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
