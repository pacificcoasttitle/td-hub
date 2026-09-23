/**
 * READ-ONLY. The list for Gerard's team: every email we recorded as sent that
 * SendGrid had already decided to drop, with the order and the people on it.
 *
 * A suppressed address is not refused. SendGrid answers 202, we log success,
 * the screen says Sent, and nothing is delivered. Six of these are prelims —
 * a client is waiting for a title report that never arrived and nobody knows.
 *
 * Output is a CSV so it can go straight to the team, plus a readable summary.
 *
 * SAFETY. Every SendGrid call is a GET. Nothing is suppressed, resent or
 * deleted, here or there. At most 20 requests, one per second.
 */
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';

const KEY = process.env.SENDGRID_API_KEY;
if (!KEY) { console.error('SENDGRID_API_KEY is not set.'); process.exit(1); }

const BASE = 'https://api.sendgrid.com/v3';
const PAGE = 500;
const MAX_PAGES = 4;
const MAX_REQUESTS = 20;
let spent = 0;

async function get<T>(path: string): Promise<T> {
  if (++spent > MAX_REQUESTS) throw new Error(`Request ceiling of ${MAX_REQUESTS} reached.`);
  if (spent > 1) await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

interface Suppressed { email: string; created: number; reason?: string; status?: string }

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

(async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

  // ── When did SendGrid start refusing each address, and why ───────────────
  const suppressed = new Map<string, { since: number; list: string; reason: string }>();
  for (const list of ['bounces', 'blocks', 'spam_reports', 'invalid_emails']) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await get<Suppressed[]>(
        `/suppression/${list}?limit=${PAGE}&offset=${page * PAGE}`,
      );
      for (const r of rows) {
        const e = r.email.toLowerCase().trim();
        const prev = suppressed.get(e);
        if (!prev || r.created < prev.since) {
          suppressed.set(e, { since: r.created, list, reason: (r.reason ?? r.status ?? '').trim() });
        }
      }
      if (rows.length < PAGE) break;
    }
  }

  // ── Every send, with the order and the people on it ──────────────────────
  const sent = await sql<{
    email: string; subject: string | null; created_at: Date;
    file_number: string | null; address: string | null; city: string | null;
    escrow_officer: string | null; escrow_email: string | null;
    title_officer: string | null; sales_rep: string | null;
  }[]>`
    SELECT lower(trim(r.email))            AS email,
           l.request_meta->>'subject'      AS subject,
           l.created_at,
           -- Only 698 of 2,255 send rows carry an order_id, but the mail itself
           -- knows its file: the client records it in request_meta, and the
           -- subject prints it. Without this fallback six of these — every one
           -- a prelim a client is still waiting for — say "no file".
           coalesce(o.file_number, l.request_meta->>'fileNumber',
                    substring(l.request_meta->>'subject' from '([0-9]{8}-[A-Z]{3})')) AS file_number,
           p.address, p.city,
           eo.full_name AS escrow_officer, eo.email AS escrow_email,
           t_o.full_name AS title_officer,
           sr.full_name AS sales_rep
    FROM vendor_api_logs l
    CROSS JOIN LATERAL jsonb_array_elements_text(
      coalesce(l.request_meta->'to', '[]'::jsonb) || coalesce(l.request_meta->'cc', '[]'::jsonb)
    ) AS r(email)
    LEFT JOIN orders o           ON o.id = l.order_id
    LEFT JOIN order_properties p ON p.order_id = o.id
    LEFT JOIN contacts eo        ON eo.id = o.escrow_officer_id
    LEFT JOIN contacts t_o       ON t_o.id = o.title_officer_id
    LEFT JOIN contacts sr        ON sr.id = o.sales_rep_id
    WHERE l.vendor = 'sendgrid' AND l.operation = 'send_email'
      AND coalesce(l.success, true) = true`;

  const kind = (s: string | null) => {
    const v = (s ?? '').trim();
    if (/^\[SAMPLE/i.test(v)) return 'sample';
    if (/^Preliminary report (not sent|sent to SoftPro)/i.test(v)) return 'internal';
    if (/^Background job |^TD Hub Daily Ops Report|^TD Hub — /i.test(v)) return 'internal';
    if (/^Preliminary Title Report/i.test(v)) return 'prelim';
    if (/·\s*Confirmation\s*$/i.test(v) || /^Open Order Confirmation/i.test(v)) return 'confirmation';
    return 'other';
  };

  const dropped = sent
    .map((r) => ({ ...r, sup: suppressed.get(r.email), kind: kind(r.subject) }))
    .filter((r) => r.sup && r.created_at.getTime() / 1000 > r.sup.since)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

  // ── Where each address is stored, so a typo can actually be corrected ────
  //
  // Not all of them are contacts. Two of the worst — the malformed ones —
  // live only on an order, typed into a form, which is why they were never
  // caught by anything looking at the contact book.
  const addresses = [...new Set(dropped.map((d) => d.email))];
  const held = new Map<string, string[]>();
  const note = (email: string, where: string) => {
    const e = email.toLowerCase().trim();
    if (!held.has(e)) held.set(e, []);
    held.get(e)!.push(where);
  };

  for (const r of await sql<{ email: string; id: number; full_name: string | null; company_name: string | null }[]>`
    SELECT lower(email) AS email, id, full_name, company_name FROM contacts WHERE lower(email) = ANY(${addresses})`) {
    note(r.email, `contacts #${r.id}${r.full_name ? ` (${r.full_name})` : ''}${r.company_name ? ` — ${r.company_name}` : ''}`);
  }
  for (const r of await sql<{ email: string; id: number; role: string | null; external_name: string | null; file_number: string | null }[]>`
    SELECT lower(op.external_email) AS email, op.id, op.role, op.external_name, o.file_number
    FROM order_parties op LEFT JOIN orders o ON o.id = op.order_id
    WHERE lower(op.external_email) = ANY(${addresses})`) {
    note(r.email, `order_parties #${r.id} (${r.role ?? 'no role'}${r.external_name ? `, ${r.external_name}` : ''}) on ${r.file_number ?? 'no file'}`);
  }
  for (const r of await sql<{ email: string; id: number; file_number: string | null }[]>`
    SELECT lower(de.email) AS email, de.id, o.file_number
    FROM order_deliverable_emails de LEFT JOIN orders o ON o.id = de.order_id
    WHERE lower(de.email) = ANY(${addresses})`) {
    note(r.email, `order_deliverable_emails #${r.id} on ${r.file_number ?? 'no file'}`);
  }

  // ── The CSV ──────────────────────────────────────────────────────────────
  const header = ['Sent', 'What', 'Recipient', 'Suppressed since', 'Why SendGrid refused it',
    'File', 'Property', 'City', 'Escrow officer', 'Escrow officer email', 'Title officer', 'Sales rep',
    'Where the address is stored', 'Subject'];
  const lines = [header.join(',')];
  for (const d of dropped) {
    lines.push([
      d.created_at.toISOString().slice(0, 10),
      d.kind,
      d.email,
      new Date(d.sup!.since * 1000).toISOString().slice(0, 10),
      `${d.sup!.list}: ${d.sup!.reason}`,
      d.file_number, d.address, d.city,
      d.escrow_officer, d.escrow_email, d.title_officer, d.sales_rep,
      (held.get(d.email) ?? ['NOT STORED ANYWHERE WE CAN SEE']).join(' | '),
      d.subject,
    ].map(csvCell).join(','));
  }
  const out = 'docs/audits/sendgrid-silent-drops.csv';
  writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');

  // ── The readable version ─────────────────────────────────────────────────
  console.log(`${dropped.length} emails recorded as sent that SendGrid had already stopped delivering`);
  console.log(`${new Set(dropped.map((d) => d.email)).size} distinct addresses\n`);

  const byAddress = new Map<string, typeof dropped>();
  for (const d of dropped) {
    if (!byAddress.has(d.email)) byAddress.set(d.email, []);
    byAddress.get(d.email)!.push(d);
  }

  for (const [email, rows] of [...byAddress].sort((a, b) => b[1].length - a[1].length)) {
    const s = rows[0]!.sup!;
    console.log(`${email}`);
    console.log(`   refused since ${new Date(s.since * 1000).toISOString().slice(0, 10)} — ${s.list}: ${s.reason.slice(0, 100)}`);
    for (const w of held.get(email) ?? ['NOT STORED ANYWHERE WE CAN SEE']) console.log(`   held in ${w}`);
    for (const r of rows) {
      const who = r.escrow_officer ? `escrow: ${r.escrow_officer}` : 'no escrow officer on file';
      console.log(`   ${r.created_at.toISOString().slice(0, 10)}  ${r.kind.padEnd(12)} ${(r.file_number ?? '—').padEnd(15)} ${(r.address ?? '—').slice(0, 38).padEnd(38)} ${who}`);
    }
    console.log('');
  }

  console.log(`CSV written to ${out}`);
  console.log(`${spent} API requests used of a ${MAX_REQUESTS} ceiling.`);
  await sql.end();
})().catch((e) => { console.error(String(e)); process.exit(1); });
