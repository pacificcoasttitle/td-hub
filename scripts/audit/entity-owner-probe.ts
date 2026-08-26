/**
 * ONE BILLABLE SiteX CALL. Feed 100001. Approved 2026-08-26.
 *
 * Target chosen from our own data so the hit cannot miss for a boring reason:
 * order 7268 / 99101044, whose stored primary_owner is "5558 RIVERTON LLC" —
 * populated BY a previous SiteX lookup, so SiteX matched this address before.
 *
 * ORDER OF OPERATIONS IS DELIBERATE. The raw response body is written to disk
 * BEFORE it is parsed, before it is analysed, before anything can throw. The
 * success path of the normal client logs {matchCode, apn} and discards the
 * body, which is exactly why this question needed a paid call in the first
 * place; we are not paying for it twice.
 *
 * Refuses to run if the output file already exists.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { getConfig, getAccessToken, logRequest } from '../../src/lib/integrations/sitex/auth';

const OUT_DIR = 'C:/Users/gerar/Desktop/TransactionDeskV2/outputs/sitex-entity';
const OUT = `${OUT_DIR}/entity-owner-100001-raw.json`;

const TARGET = {
  orderId: 7268,
  fileNumber: '99101044',
  storedOwner: '5558 RIVERTON LLC',
  street: '5558 RIVERTON AVE',
  city: 'North Hollywood',
  state: 'CA',
  zip: '91601',
  apn: '2416-017-008',
};

const truncateZip = (z: string) => z.trim().slice(0, 5);

(async () => {
  if (fs.existsSync(OUT)) {
    console.error(`REFUSING. ${OUT} already exists — the call has been made. Analyse the file.`);
    process.exit(1);
  }
  const cfg = getConfig();
  if (!cfg) { console.error('SiteX not configured'); process.exit(1); }
  if (cfg.feedId !== '100001') {
    console.error(`REFUSING. SITEX_FEED_ID is "${cfg.feedId}", expected 100001.`);
    process.exit(1);
  }

  const lastLine = `${TARGET.city}, ${TARGET.state}, ${truncateZip(TARGET.zip)}`;
  const url = new URL(`${cfg.baseUrl}/realestatedata/search`);
  url.searchParams.set('addr', TARGET.street);
  url.searchParams.set('lastLine', lastLine);
  url.searchParams.set('feedId', cfg.feedId);

  console.log('THE ONE CALL');
  console.log(`  addr     ${TARGET.street}`);
  console.log(`  lastLine ${lastLine}`);
  console.log(`  feedId   ${cfg.feedId}`);
  console.log(`  we already store owner = "${TARGET.storedOwner}" for this property\n`);

  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const token = await getAccessToken(cfg.baseUrl, cfg.clientId, cfg.clientSecret);
  const res = await fetch(url.toString(), {
    method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  const durationMs = Date.now() - startedAt.getTime();

  // ── PERSIST FIRST. Nothing above this line parses the body. ───────────────
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, body);
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  console.log(`RAW PERSISTED  ${OUT}`);
  console.log(`  HTTP ${res.status}  ${body.length} bytes  sha256 ${sha.slice(0, 32)}…  ${durationMs} ms\n`);

  let payload: Record<string, any> | null = null;
  try { payload = JSON.parse(body); } catch { /* leave null; the file is safe */ }

  await logRequest({
    operation: 'entity_owner_probe',
    requestId, startedAt, success: res.ok,
    requestMeta: { addr: TARGET.street, lastLine, feedId: cfg.feedId, orderId: TARGET.orderId },
    responseMeta: {
      httpStatus: res.status, bytes: body.length, sha256: sha,
      rawFile: OUT,
      searchId: payload?.OrderInfo?.SearchId ?? null,
      note: 'One approved billable call. Raw body persisted to rawFile.',
    },
  });

  if (!payload) { console.error('Body was not JSON. It is on disk; stopping.'); process.exit(1); }

  const feed = payload.Feed ?? {};
  const pp = feed.PropertyProfile ?? {};
  const th: any[] = Array.isArray(feed.TransferHistory) ? feed.TransferHistory : [];

  console.log('═'.repeat(84));
  console.log('Q1  WHAT PrimaryOwnerName CONTAINS FOR AN ENTITY');
  console.log('═'.repeat(84));
  console.log(`  PrimaryOwnerName   ${JSON.stringify(pp.PrimaryOwnerName)}`);
  console.log(`  SecondaryOwnerName ${'SecondaryOwnerName' in pp ? JSON.stringify(pp.SecondaryOwnerName) : '(field absent)'}`);
  console.log(`  every PropertyProfile key matching /owner/i: ${Object.keys(pp).filter((k) => /owner/i.test(k)).join(', ') || '(none)'}`);
  console.log(`  OrderInfo.SearchId  ${payload.OrderInfo?.SearchId ?? '(none)'}   <- invoice handle`);

  console.log('\n' + '═'.repeat(84));
  console.log('Q2  IS TransferHistory PRESENT, AND DOES ANYTHING CARRY CurrentOwnerFlag');
  console.log('═'.repeat(84));
  console.log(`  TransferHistory entries: ${th.length}`);
  const flagged = th.filter((t) => String(t?.CurrentOwnerFlag).toLowerCase() === 'true');
  console.log(`  entries with CurrentOwnerFlag true: ${flagged.length}`);
  for (const [i, t] of th.entries()) {
    const sections = Object.keys(t).filter((k) => ['Deed', 'Mortgage', 'Foreclosure', 'Assignment', 'Transfer'].includes(k));
    console.log(`    [${String(i).padStart(2)}] ${String(t.TransactionType ?? '?').padEnd(16)} ` +
      `CurrentOwnerFlag=${String(t.CurrentOwnerFlag).padEnd(6)} rec=${String(t.RecordingDate ?? '').padEnd(11)} sections: ${sections.join(', ') || '(none)'}`);
  }

  console.log('\n' + '═'.repeat(84));
  console.log('Q3  THE DISCRIMINATOR — LastOrCorporateName vs FirstAndMiddleName');
  console.log('═'.repeat(84));
  const parties: Array<{ where: string; p: any }> = [];
  const collect = (o: any, where: string) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries<any>(o)) {
      if (v && typeof v === 'object' && 'LastOrCorporateName' in v) parties.push({ where: `${where}.${k}`, p: v });
      else if (Array.isArray(v)) v.forEach((x, i) => collect(x, `${where}.${k}[${i}]`));
      else collect(v, `${where}.${k}`);
    }
  };
  th.forEach((t, i) => collect(t, `TransferHistory[${i}]`));
  if (parties.length === 0) console.log('  (no party object with LastOrCorporateName found)');
  for (const { where, p } of parties) {
    const first = p.FirstAndMiddleName;
    const empty = first === null || first === undefined || String(first).trim() === '';
    console.log(`  ${where}`);
    console.log(`      LastOrCorporateName  ${JSON.stringify(p.LastOrCorporateName)}`);
    console.log(`      FirstAndMiddleName   ${JSON.stringify(first)}   ${empty ? '<-- EMPTY' : ''}`);
    console.log(`      EntityCode/Desc      ${JSON.stringify(p.EntityCode)} / ${JSON.stringify(p.EntityCodeDesc)}`);
  }

  console.log('\n' + '═'.repeat(84));
  console.log('Q4  EntityCode AND VestingCode ON AN ENTITY-OWNED PROPERTY');
  console.log('═'.repeat(84));
  const codes: string[] = [];
  (function w(o: any, p: string) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach((v, i) => w(v, `${p}[${i}]`));
    for (const [k, v] of Object.entries(o)) {
      if (/^(Vesting|Entity)Code(Desc)?$/.test(k)) codes.push(`  ${p}.${k} = ${JSON.stringify(v)}`);
      w(v, p ? `${p}.${k}` : k);
    }
  })(feed, 'Feed');
  console.log(codes.length ? codes.join('\n') : '  (none present)');

  console.log(`\nraw payload: ${OUT}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
