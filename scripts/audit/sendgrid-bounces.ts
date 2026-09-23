/**
 * READ-ONLY. What SendGrid did with the mail we sent, split by what we sent.
 *
 * The dashboard shows bounces, blocks and spam reports as one pile. That pile
 * cannot answer the question we actually have — is the PRELIM path losing
 * mail, or the CONFIRMATION path? — because SendGrid does not know which of
 * our emails is which. Our own send log does: it records every recipient and
 * subject, so the split is ours to make.
 *
 * SAFETY. Every call is a GET. Nothing here suppresses, deletes, resends or
 * writes anything, at SendGrid or in our database.
 *
 * RATE AND CEILING (the FortiGuard lesson of 2026-09-16, applied before rather
 * than after): at most MAX_REQUESTS calls, one per second, MAX_PAGES pages per
 * list. If a list is longer than that the script says so and stops, rather
 * than walking a vendor's API until something upstream decides we are an
 * attack.
 */
import postgres from 'postgres';

const KEY = process.env.SENDGRID_API_KEY;
if (!KEY) { console.error('SENDGRID_API_KEY is not set.'); process.exit(1); }

const BASE = 'https://api.sendgrid.com/v3';
const PAGE = 500;
const MAX_PAGES = 4;          // 2000 addresses per list — far above our volume
const MAX_REQUESTS = 20;
const GAP_MS = 1000;

let spent = 0;

async function get<T>(path: string): Promise<T> {
  if (++spent > MAX_REQUESTS) throw new Error(`Request ceiling of ${MAX_REQUESTS} reached at ${path}.`);
  if (spent > 1) await new Promise((r) => setTimeout(r, GAP_MS));
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text().catch(() => '')}`);
  return res.json() as Promise<T>;
}

interface Suppressed { email: string; created: number; reason?: string; status?: string }

/** A suppression list, walked to the ceiling. `complete` says whether we saw the end. */
async function suppressionList(kind: string, from: number, to: number) {
  const rows: Suppressed[] = [];
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = `?start_time=${from}&end_time=${to}&limit=${PAGE}&offset=${page * PAGE}`;
    const batch = await get<Suppressed[]>(`/suppression/${kind}${q}`);
    rows.push(...batch);
    if (batch.length < PAGE) { complete = true; break; }
  }
  return { rows, complete };
}

// ─── Which of our emails is this? ───────────────────────────────────────────
//
// Order matters. The internal alerts about prelims ("Preliminary report not
// sent — SoftPro has no recipient") begin with the same word as the prelims
// themselves and go to our own staff, so they are matched FIRST. A prefix
// match on /^Preliminar/ would have filed twelve internal notices as client
// prelim deliveries.
type Kind = 'prelim' | 'confirmation' | 'internal' | 'sample' | 'other';

function classify(subject: string | null): Kind {
  const s = (subject ?? '').trim();
  if (/^\[SAMPLE/i.test(s)) return 'sample';
  if (/^Preliminary report (not sent|sent to SoftPro)/i.test(s)) return 'internal';
  if (/^Background job |^TD Hub Daily Ops Report|^TD Hub — /i.test(s)) return 'internal';
  if (/^Preliminary Title Report/i.test(s)) return 'prelim';
  if (/·\s*Confirmation\s*$/i.test(s) || /^Open Order Confirmation/i.test(s)) return 'confirmation';
  return 'other';
}

const KINDS: Kind[] = ['prelim', 'confirmation', 'internal', 'sample', 'other'];
const pad = (v: unknown, n: number) => String(v).padStart(n);

(async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

  // ── Our side: every address we sent to, and what we sent it ──────────────
  const sent = await sql<{ email: string; subject: string | null; created_at: Date; success: boolean | null }[]>`
    SELECT lower(trim(r.email))   AS email,
           l.request_meta->>'subject' AS subject,
           l.created_at,
           l.success
    FROM vendor_api_logs l
    CROSS JOIN LATERAL jsonb_array_elements_text(
      coalesce(l.request_meta->'to', '[]'::jsonb) || coalesce(l.request_meta->'cc', '[]'::jsonb)
    ) AS r(email)
    WHERE l.vendor = 'sendgrid' AND l.operation = 'send_email'`;

  const first = sent.reduce((a, r) => (r.created_at < a ? r.created_at : a), sent[0]!.created_at);
  const from = Math.floor(first.getTime() / 1000) - 86_400;
  const to = Math.floor(Date.now() / 1000);

  /** Every kind we ever sent to an address. One address can appear in several. */
  const kindsOf = new Map<string, Set<Kind>>();
  const sendsByKind = new Map<Kind, number>();
  const addressesByKind = new Map<Kind, Set<string>>();
  for (const r of sent) {
    const k = classify(r.subject);
    sendsByKind.set(k, (sendsByKind.get(k) ?? 0) + 1);
    if (!kindsOf.has(r.email)) kindsOf.set(r.email, new Set());
    kindsOf.get(r.email)!.add(k);
    if (!addressesByKind.has(k)) addressesByKind.set(k, new Set());
    addressesByKind.get(k)!.add(r.email);
  }

  console.log('─── What we sent ──────────────────────────────────────────────');
  console.log(`${sent.length} deliveries to ${kindsOf.size} distinct addresses, since ${first.toISOString().slice(0, 10)}`);
  for (const k of KINDS) {
    console.log(`  ${k.padEnd(13)} ${pad(sendsByKind.get(k) ?? 0, 5)} sends   ${pad(addressesByKind.get(k)?.size ?? 0, 4)} addresses`);
  }
  const failed = sent.filter((r) => r.success === false);
  if (failed.length) console.log(`  (${failed.length} of those never left: SendGrid refused the request itself)`);

  // ── SendGrid's side ──────────────────────────────────────────────────────
  const stats = await get<{ date: string; stats: { metrics: Record<string, number> }[] }[]>(
    `/stats?start_date=${new Date(from * 1000).toISOString().slice(0, 10)}&end_date=${new Date().toISOString().slice(0, 10)}&aggregated_by=month`,
  );
  const totals: Record<string, number> = {};
  for (const day of stats) for (const s of day.stats) {
    for (const [k, v] of Object.entries(s.metrics)) totals[k] = (totals[k] ?? 0) + v;
  }
  console.log('\n─── What SendGrid counted (whole account, all mail) ────────────');
  for (const k of ['requests', 'delivered', 'bounces', 'bounce_drops', 'blocks', 'spam_reports', 'invalid_emails', 'deferred']) {
    if (totals[k]) console.log(`  ${k.padEnd(15)} ${pad(totals[k], 6)}`);
  }
  const delivered = totals.delivered ?? 0;
  const requests = totals.requests ?? 0;
  if (requests) console.log(`  delivery rate   ${((delivered / requests) * 100).toFixed(2)}%`);

  console.log('\n─── Who it lost, and on which path ────────────────────────────');
  const lists: Array<[string, string]> = [
    ['bounces', 'hard/soft bounce'],
    ['blocks', 'blocked by the receiving server'],
    ['spam_reports', 'marked as spam'],
    ['invalid_emails', 'address was not valid'],
  ];

  const unattributed: string[] = [];
  /** email → earliest moment SendGrid began refusing it, across all four lists. */
  const suppressedSince = new Map<string, number>();
  for (const [kind, label] of lists) {
    const { rows, complete } = await suppressionList(kind, from, to);
    for (const r of rows) {
      const e = r.email.toLowerCase().trim();
      const prev = suppressedSince.get(e);
      if (prev === undefined || r.created < prev) suppressedSince.set(e, r.created);
    }
    console.log(`\n${kind.toUpperCase()} — ${label}${complete ? '' : `  (TRUNCATED at ${MAX_PAGES * PAGE})`}`);
    if (rows.length === 0) { console.log('  none'); continue; }

    const perKind = new Map<Kind, Suppressed[]>();
    for (const row of rows) {
      const email = row.email.toLowerCase().trim();
      const ks = kindsOf.get(email);
      if (!ks) { unattributed.push(`${kind}: ${email}`); continue; }
      for (const k of ks) {
        if (!perKind.has(k)) perKind.set(k, []);
        perKind.get(k)!.push(row);
      }
    }
    for (const k of KINDS) {
      const hit = perKind.get(k);
      if (!hit?.length) continue;
      const of = addressesByKind.get(k)?.size ?? 0;
      console.log(`  ${k.padEnd(13)} ${pad(hit.length, 4)} of ${of} addresses (${((hit.length / (of || 1)) * 100).toFixed(1)}%)`);
      for (const r of hit) {
        const when = new Date(r.created * 1000).toISOString().slice(0, 10);
        console.log(`      ${when}  ${r.email.padEnd(34)} ${(r.reason ?? r.status ?? '').slice(0, 90)}`);
      }
    }
  }

  if (unattributed.length) {
    console.log(`\n─── On SendGrid's lists, never sent to by this app ─────────────`);
    console.log('  Older mail, another sender on the same account, or a list that predates us.');
    for (const u of unattributed.slice(0, 40)) console.log(`  ${u}`);
    if (unattributed.length > 40) console.log(`  …and ${unattributed.length - 40} more`);
  }

  // ── The silent drops ─────────────────────────────────────────────────────
  //
  // Once an address is on a suppression list, SendGrid still answers our API
  // call with a 202. It simply does not deliver. Our log records success, the
  // Reports list says "Sent", and nobody is told. Every send below is one we
  // believe went out and that SendGrid had already decided to drop.
  const dropped = sent
    .filter((r) => r.success !== false)
    .map((r) => ({ ...r, since: suppressedSince.get(r.email) }))
    .filter((r) => r.since !== undefined && r.created_at.getTime() / 1000 > r.since!)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

  console.log('\n─── Recorded as sent, after SendGrid had stopped delivering ───');
  if (dropped.length === 0) {
    console.log('  none — every send predates its address being suppressed');
  } else {
    const byKind = new Map<Kind, number>();
    for (const d of dropped) byKind.set(classify(d.subject), (byKind.get(classify(d.subject)) ?? 0) + 1);
    console.log(`  ${dropped.length} sends to ${new Set(dropped.map((d) => d.email)).size} suppressed addresses`);
    for (const k of KINDS) if (byKind.get(k)) console.log(`    ${k.padEnd(13)} ${pad(byKind.get(k), 4)}`);
    for (const d of dropped.slice(0, 15)) {
      console.log(`      ${d.created_at.toISOString().slice(0, 10)}  ${d.email.padEnd(34)} ${(d.subject ?? '').slice(0, 60)}`);
    }
    if (dropped.length > 15) console.log(`      …and ${dropped.length - 15} more`);
  }

  console.log(`\n${spent} API requests used of a ${MAX_REQUESTS} ceiling.`);
  await sql.end();
})().catch((e) => { console.error(String(e)); process.exit(1); });
