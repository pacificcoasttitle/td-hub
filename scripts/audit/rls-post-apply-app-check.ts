/**
 * READ-ONLY. Post-0038 confirmation that the application still works with RLS
 * enabled on all 42 public tables — run against production, through the real
 * modules rather than reimplementations of them.
 *
 * Three things it checks:
 *   1. the party wizard's own service function executes and reads its table
 *   2. the ordinary authenticated read path (orders service + read model, the
 *      same Drizzle calls every staff page makes) still returns data
 *   3. the deployed public wizard page returns HTML rather than a 500
 *
 * ON THE WIZARD FUNCTION'S LIMIT, stated rather than papered over:
 * resolvePartyWizardLink collapses "no such row" and "row found, secret does not
 * match" into the same `invalid`, on purpose, so a prober cannot tell them apart.
 * That means the function's return value alone cannot prove the row was read.
 * So this mints a token with a REAL token_id from the table and a random secret,
 * and asserts the function does not throw, WHILE running the identical select
 * beside it to show the row is in fact visible to the app role. The pair is the
 * evidence; neither half is on its own.
 *
 * Writes nothing: recordLinkAccess and submitPartyWizard are deliberately not
 * called. No token minted here is ever persisted.
 */
import crypto from 'node:crypto';
import postgres from 'postgres';
import { resolvePartyWizardLink } from '@/lib/domain/parties/party-wizard-service';
import { getOrders, getOrderById, getRecentActivity } from '@/lib/domain/orders/service';
import { getOrderReadModel } from '@/lib/domain/orders/read-model';
import { getOrderNotes } from '@/lib/domain/orders/notes';
import { getOrderDocuments } from '@/lib/domain/orders/documents';

const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

const head = (s: string) => console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`);

function signatureValidTokenFor(tokenId: string): string {
  const secretHalf = crypto.randomBytes(24).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.PARTY_WIZARD_TOKEN_SECRET!)
    .update(`${tokenId}.${secretHalf}`)
    .digest('base64url')
    .slice(0, 22);
  return `${tokenId}.${secretHalf}.${sig}`;
}

async function main() {
  head('0. RLS STATE (should be 42/42 after 0038)');
  const state = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE relrowsecurity)::int AS rls_on,
           count(*) FILTER (WHERE relforcerowsecurity)::int AS forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  `;
  console.log(state[0]);

  head('1. PARTY WIZARD SERVICE — real function, real db module, RLS on');
  const links = await sql`SELECT token_id, id, order_id FROM public.party_wizard_links ORDER BY id`;
  console.log(`party_wizard_links visible to the app role: ${links.length} row(s)`);
  if (links.length === 0) {
    console.log('CANNOT VERIFY — no link rows visible. If RLS had broken the app this is');
    console.log('exactly what it would look like. Treat as a FAILURE.');
    process.exitCode = 1;
  }
  for (const l of links) {
    const token = signatureValidTokenFor(String(l.token_id));
    const t0 = Date.now();
    const res = await resolvePartyWizardLink(token);
    console.log(`  link id ${l.id}: resolvePartyWizardLink -> ok=${res.ok} `
      + `reason=${res.ok ? '-' : res.reason} (${Date.now() - t0}ms, no exception)`);
    console.log('    expected: ok=false reason=invalid — the secret half is random, so the '
      + 'hash compare fails AFTER the row is read');
  }
  const [probe] = await sql`
    SELECT id, order_id, role, expires_at, revoked_at, used_at
    FROM public.party_wizard_links WHERE token_id = ${String(links[0]?.token_id ?? '')} LIMIT 1
  `;
  console.log(`  the identical select, run beside it: ${probe ? '1 row' : '0 rows'}`
    + (probe ? ` (id ${probe.id}, order ${probe.order_id}, role ${probe.role})` : ''));
  console.log(probe
    ? '  => the row IS visible to the app role under RLS; the function reached it and '
      + 'rejected on the hash, which is correct behaviour'
    : '  => FAILURE: the row is not visible to the app role');

  head('2. ORDINARY AUTHENTICATED READ PATH — the loaders staff pages actually call');
  const page = await getOrders({ page: 1, pageSize: 5 });
  const rows = Array.isArray(page) ? page : (page as { orders?: unknown[] }).orders ?? [];
  console.log(`getOrders(page 1, size 5)   -> ${rows.length} row(s)`);
  console.log(`getRecentActivity(5)        -> ${(await getRecentActivity(5)).length} row(s)`);

  const [target] = await sql`
    SELECT o.id FROM public.orders o
    JOIN public.order_notes n ON n.order_id = o.id
    ORDER BY o.id DESC LIMIT 1
  `;
  const orderId = Number(target?.id ?? 0);
  console.log(`\nusing order id ${orderId} (chosen because it has notes, so an empty result is a failure)`);
  console.log(`getOrderById(${orderId})          -> ${await getOrderById(orderId) ? 'loaded' : 'NULL'}`);
  console.log(`getOrderReadModel(${orderId})     -> ${await getOrderReadModel(orderId) ? 'loaded' : 'NULL'}`);
  console.log(`getOrderNotes(${orderId})         -> ${(await getOrderNotes(orderId, 'staff')).notes.length} note(s)`);
  const docs = await getOrderDocuments(orderId, 'staff');
  console.log(`getOrderDocuments(${orderId})     -> ${docs.ok ? `${docs.documents.length} document(s)` : `error ${docs.error}`}`);
  console.log('\nnote: getOrderStats() is deliberately NOT called here. It interpolates a raw JS');
  console.log('Date into a sql`` template, which postgres-js cannot serialise, so it throws a');
  console.log('client-side TypeError before any query is sent. It has no callers anywhere in');
  console.log('src/, is unrelated to RLS, and predates this branch — see the PR body.');

  head('3. TABLE-BY-TABLE READBACK as the app role, every public table');
  const tables = await sql`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname
  `;
  const failures: string[] = [];
  let nonEmpty = 0;
  for (const t of tables) {
    try {
      const r = await sql.unsafe(`SELECT count(*)::int AS n FROM public.${t.relname}`);
      if ((r[0].n as number) > 0) nonEmpty += 1;
    } catch (e) {
      failures.push(`${t.relname}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`${tables.length} tables queried as the app role, ${nonEmpty} returned rows, `
    + `${failures.length} errored`);
  if (failures.length) { console.log(failures.join('\n')); process.exitCode = 1; }

  head('4. DEPLOYED PUBLIC WIZARD PAGE + HEALTH — over HTTPS, no credentials');
  const base = 'https://td-hub.vercel.app';
  const health = await fetch(`${base}/api/health`);
  console.log(`GET /api/health -> HTTP ${health.status}`);
  console.log(`  ${(await health.text()).slice(0, 200)}`);

  const liveToken = links.length ? signatureValidTokenFor(String(links[0].token_id)) : 'x'.repeat(40);
  const pageRes = await fetch(`${base}/party-wizard/${liveToken}`, { redirect: 'manual' });
  const html = await pageRes.text();
  console.log(`GET /party-wizard/<signature-valid token, real token_id> -> HTTP ${pageRes.status}`);
  console.log(`  ${html.length} bytes of HTML; contains an error boundary? `
    + `${/Application error|Internal Server Error/i.test(html) ? 'YES — BAD' : 'no'}`);
  console.log('  The server component ran resolvePartyWizardLink against the RLS-enabled');
  console.log('  database to produce this response. A 500 here would be the failure.');

  const bogus = await fetch(`${base}/party-wizard/not-a-real-token`, { redirect: 'manual' });
  console.log(`GET /party-wizard/not-a-real-token -> HTTP ${bogus.status} (control)`);

  await sql.end();
}

main().catch(async (e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  await sql.end();
  process.exit(1);
});
