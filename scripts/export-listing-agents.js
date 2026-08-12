/**
 * Export listing agents per sales rep as Mailchimp-ready CSVs.
 *
 * Read-only against the database. Writes CSVs to an output directory OUTSIDE
 * the repository — these files contain contact email addresses and must not be
 * committed.
 *
 * Run:
 *   node scripts/export-listing-agents.js [outputDir]
 */
const fs = require('node:fs');
const path = require('node:path');
const p = require('postgres');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

const OUT_DIR = process.argv[2]
  || path.join('C:', 'Users', 'gerar', 'Desktop', 'TransactionDeskV2', 'agent-exports');

const sql = p(process.env.DATABASE_URL, { ssl: 'require' });

// ── Exclusions ──────────────────────────────────────────────────────────────
const INTERNAL_DOMAINS = ['pct.com', 'wltic.com', 'pacificcoasttitle.com'];
const TEST_DOMAINS = ['yopmail.com'];
const HOUSE_ACCOUNT = /house\s*account/i;

// ── Confirmed identity mapping (TD rep name -> marketing identity) ──────────
// Team accounts group into one file under the real person's name.
const REP_IDENTITY = {
  'Team Meza': 'Jorge Mesa',
  'Jorge Mesa': 'Jorge Mesa',
  'Angeline Wu': 'Angeline Ahn',
  'Lopez Team': 'Hugo Lopez',
  'Title Team': 'Nicole Ahn',
  'Title Gals': 'Janelly Marquez',
  'Nicholas Watt': 'Nick Watt',
};

const norm = (s) => (s ?? '').normalize('NFC').trim().toLowerCase();
const domainOf = (e) => { const i = e.lastIndexOf('@'); return i === -1 ? '' : e.slice(i + 1); };

function slug(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** RFC4180: quote when the value contains a comma, quote, CR or LF. */
function csvCell(v) {
  const s = (v ?? '').toString().trim();
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function splitName(full) {
  const t = (full ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return { first: '', last: '' };
  const parts = t.split(' ');
  return parts.length === 1
    ? { first: parts[0], last: '' }
    : { first: parts[0], last: parts.slice(1).join(' ') };
}

(async () => {
  const rows = await sql`
    select
      coalesce(c.full_name, trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))) as rep_name,
      c.email as rep_email,
      op.external_email as agent_email,
      op.external_name  as agent_name,
      op.external_company as agent_company,
      o.opened_at
    from order_parties op
    join orders o   on o.id = op.order_id
    join contacts c on c.id = o.sales_rep_id
    where op.role = 'listing_agent'
      and o.opened_at >= now() - interval '365 days'
      and o.opened_at <= now()
    order by o.opened_at desc`;

  // rep identity -> { repNames:Set, byEmail:Map }
  const groups = new Map();
  const stats = { rows: rows.length, noEmail: 0, internal: 0, test: 0, self: 0, house: 0, dupes: 0 };

  for (const r of rows) {
    const repName = (r.rep_name ?? '').trim();
    if (!repName) continue;

    if (HOUSE_ACCOUNT.test(repName)) { stats.house++; continue; }

    const email = norm(r.agent_email);
    if (!email) { stats.noEmail++; continue; }

    const dom = domainOf(email);
    if (INTERNAL_DOMAINS.includes(dom)) { stats.internal++; continue; }
    if (TEST_DOMAINS.includes(dom)) { stats.test++; continue; }
    if (norm(r.rep_email) && norm(r.rep_email) === email) { stats.self++; continue; }

    const identity = REP_IDENTITY[repName] ?? repName;
    if (!groups.has(identity)) groups.set(identity, { repNames: new Set(), byEmail: new Map() });
    const g = groups.get(identity);
    g.repNames.add(repName);

    if (g.byEmail.has(email)) {
      stats.dupes++;
      // Keep the richer record: fill blanks from a later row rather than
      // discarding a name/company we only saw once.
      const prev = g.byEmail.get(email);
      const { first, last } = splitName(r.agent_name);
      if (!prev.first && first) prev.first = first;
      if (!prev.last && last) prev.last = last;
      if (!prev.company && r.agent_company) prev.company = r.agent_company.trim();
      continue;
    }
    const { first, last } = splitName(r.agent_name);
    g.byEmail.set(email, { email, first, last, company: (r.agent_company ?? '').trim() });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);

  const summary = [];
  for (const [identity, g] of groups) {
    const contacts = [...g.byEmail.values()]
      .sort((a, b) => a.email.localeCompare(b.email));
    const file = `${slug(identity)}-listing-agents-${stamp}.csv`;
    const lines = ['Email Address,First Name,Last Name,Company'];
    for (const c of contacts) {
      lines.push([c.email, c.first, c.last, c.company].map(csvCell).join(','));
    }
    // BOM so Excel opens UTF-8 names (José, Ramírez) correctly.
    fs.writeFileSync(path.join(OUT_DIR, file), `﻿${lines.join('\r\n')}\r\n`, 'utf8');
    summary.push({
      identity, agents: contacts.length, file,
      sourceReps: [...g.repNames].sort().join(' + '),
    });
  }

  summary.sort((a, b) => b.agents - a.agents);

  // Reps active in the window who produced no file at all.
  const activeReps = await sql`
    select distinct coalesce(c.full_name, trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))) as rep_name
    from orders o join contacts c on c.id = o.sales_rep_id
    where o.opened_at >= now() - interval '365 days' and o.opened_at <= now()`;
  const covered = new Set();
  for (const s of summary) for (const n of s.sourceReps.split(' + ')) covered.add(n);
  const zero = activeReps
    .map((r) => (r.rep_name ?? '').trim())
    .filter((n) => n && !covered.has(n))
    .sort();

  console.log(`OUTPUT DIR: ${OUT_DIR}`);
  console.log(`\n=== FILES (${summary.length}) ===`);
  console.log('agents  rep (marketing identity)      source rep(s)');
  for (const s of summary) {
    const via = s.sourceReps !== s.identity ? s.sourceReps : '';
    console.log(`${String(s.agents).padStart(6)}  ${s.identity.padEnd(28)}  ${via}`);
  }

  console.log(`\n=== REPS WITH ZERO LISTING AGENTS (${zero.length}) — no file written ===`);
  for (const n of zero) console.log(`  ${n}`);

  console.log('\n=== ROWS EXCLUDED ===');
  console.log(`  source rows scanned : ${stats.rows}`);
  console.log(`  no email            : ${stats.noEmail}`);
  console.log(`  internal domain     : ${stats.internal}`);
  console.log(`  test domain         : ${stats.test}`);
  console.log(`  rep's own address   : ${stats.self}`);
  console.log(`  house account rep   : ${stats.house}`);
  console.log(`  duplicate (merged)  : ${stats.dupes}`);
  console.log(`  TOTAL unique agents : ${summary.reduce((a, s) => a + s.agents, 0)}`);

  await sql.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
