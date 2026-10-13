/**
 * INCIDENT RECONCILIATION, READ ONLY. For every hub create attempt that failed
 * during the outage: does SoftPro have a file at that address, and its number?
 *
 * This is the list the team works from. NOBODY RE-ENTERS ANYTHING UNTIL IT
 * EXISTS — that is how duplicate files happen.
 *
 * Replaces incident-reconcile-addresses.ts, which was edited through a bash
 * heredoc and ended up with literal BACKSPACE bytes (0x08) where `\b` was
 * meant. Every suffix regex became "match a literal backspace", which never
 * matches, so the normalisation ran and did nothing — and the script reported
 * NO FILE FOUND for an address SoftPro holds. Code that runs and does nothing.
 * This file is written whole, by the editor, and never patched by a script.
 *
 * ─── WHAT IT DOES AND DOES NOT DO ───────────────────────────────────────────
 *
 * NO WRITES. No hub rows, no links, no creates. One read of vendor_api_logs and
 * one read of SoftPro. A person decides what to do with the output.
 *
 * ONE VENDOR CALL, NOT ONE PER ADDRESS. GetOrderDetails takes a date range and
 * returns every order in it, so the addresses are matched against a single
 * fetch rather than hitting a box that answers a trivial lookup in 11 seconds.
 *
 * IT REPORTS EVERY MATCH, NOT THE NEWEST. findCreatedSoftProFile() returns the
 * newest because its caller needs one answer for one operator. Here the
 * opposite is wanted: two files at one address IS the finding.
 *
 * IT SHOWS ITS WORK ON A NEGATIVE. "No file found" is the answer that lets
 * somebody re-enter an order, so it prints the near misses. That is not
 * decoration — the hub's own matcher missed "Evans Road" against "Evans Rd"
 * and reported nothing, and a near-miss list is what made it visible.
 *
 *   npx tsx --env-file=.env.local scripts/audit/incident-reconcile.ts [hours]
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { getOrderDetails } from '@/lib/integrations/softpro';
import { addressesMatch, normalizeAddressKey } from '@/lib/domain/orders/recover-created-file';
import type { SoftProOrderDetailItem } from '@/lib/integrations/softpro/types';

const hours = Number.isFinite(Number(process.argv[2])) && Number(process.argv[2]) > 0
  ? Number(process.argv[2]) : 24;

interface Attempt {
  at: string;
  success: boolean;
  errorCategory: string | null;
  ms: number | null;
  startedAt: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  apn: string;
}

// ─── Street suffixes, because the hub's own matcher does not do them ────────
//
// addressesMatch() strips non-alphanumerics and asks whether either string
// contains the other. That is not enough: SoftPro holds "20715 Evans Road"
// and the hub sent "20715 Evans Rd", giving 20715EVANSROAD and 20715EVANSRD —
// neither contains the other. The hub reported no file for an address that
// has one, which is the duplicate-creation path exactly.
//
// THIS COMPENSATES; IT DOES NOT FIX IT. recover-created-file.ts is live in the
// product's recovery path and needs its own reviewed change. What is here is
// deliberately WIDER than the hub's, because it is used to decide NOT to
// re-enter: a false match costs a second look, a missed match costs a
// duplicate file.
const SUFFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(ROAD|RD)\b/g, 'RD'],
  [/\b(STREET|STR|ST)\b/g, 'ST'],
  [/\b(AVENUE|AVE|AV)\b/g, 'AVE'],
  [/\b(DRIVE|DR)\b/g, 'DR'],
  [/\b(BOULEVARD|BLVD)\b/g, 'BLVD'],
  [/\b(LANE|LN)\b/g, 'LN'],
  [/\b(COURT|CT)\b/g, 'CT'],
  [/\b(PLACE|PL)\b/g, 'PL'],
  [/\b(TERRACE|TER)\b/g, 'TER'],
  [/\b(CIRCLE|CIR)\b/g, 'CIR'],
  [/\b(PARKWAY|PKWY)\b/g, 'PKWY'],
  [/\b(HIGHWAY|HWY)\b/g, 'HWY'],
  [/\b(TRAIL|TRL)\b/g, 'TRL'],
  [/\b(WAY|WY)\b/g, 'WAY'],
  [/\b(NORTH)\b/g, 'N'],
  [/\b(SOUTH)\b/g, 'S'],
  [/\b(EAST)\b/g, 'E'],
  [/\b(WEST)\b/g, 'W'],
];

export function streetKey(raw: string | null | undefined): string {
  let t = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  for (const [re, to] of SUFFIXES) t = t.replace(re, to);
  return t.replace(/\s+/g, '');
}

/** The hub's match, widened by suffix normalisation. Says which one hit. */
export function matchWide(
  row: { Address?: string | null; City?: string | null },
  input: { address: string; city?: string },
): { hit: boolean; viaHubMatcher: boolean } {
  if (addressesMatch(row, input)) return { hit: true, viaHubMatcher: true };
  const a = streetKey(row.Address);
  const b = streetKey(input.address);
  if (!a || !b) return { hit: false, viaHubMatcher: false };
  if (!(a === b || a.includes(b) || b.includes(a))) return { hit: false, viaHubMatcher: false };
  const ca = normalizeAddressKey(row.City);
  const cb = normalizeAddressKey(input.city);
  if (!ca || !cb) return { hit: true, viaHubMatcher: false };
  return { hit: ca === cb, viaHubMatcher: false };
}

function pacificDateMdY(d: Date, dayOffset: number): string {
  const shifted = new Date(d.getTime() + dayOffset * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(shifted);
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  return `${month}-${day}-${year}`;
}

async function main() {
  console.log(`\nnow: ${new Date().toISOString()}   window: last ${hours}h\n`);

  const r = await db.execute(sql`
    select to_char(created_at, 'MM-DD HH24:MI:SS')                   as at,
           to_char(started_at, 'MM-DD HH24:MI:SS')                   as started,
           success, error_category,
           (extract(epoch from (ended_at - started_at)) * 1000)::int  as ms,
           request_meta
      from vendor_api_logs
     where vendor = 'softpro' and operation = 'create_order'
       and created_at >= now() - interval '${sql.raw(String(hours))} hours'
     order by created_at asc`);
  const rows = (r as unknown as { rows?: Record<string, unknown>[] }).rows
    ?? (r as unknown as Record<string, unknown>[]);

  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const attempts: Attempt[] = rows.map((x) => {
    const req = (x.request_meta ?? {}) as Record<string, unknown>;
    const payload = (req.payload ?? {}) as Record<string, unknown>;
    const pd = (payload.propertyDetails ?? {}) as Record<string, unknown>;
    return {
      at: String(x.at),
      startedAt: String(x.started),
      success: Boolean(x.success),
      errorCategory: (x.error_category as string | null) ?? null,
      ms: (x.ms as number | null) ?? null,
      address: s(pd.Address1),
      city: s(pd.City),
      state: s(pd.State),
      zip: s(pd.Zip),
      apn: s(pd.APNNumberParcelID),
    };
  });

  const failed = attempts.filter((a) => !a.success);
  const ok = attempts.filter((a) => a.success);
  console.log(`${attempts.length} create attempt(s): ${ok.length} succeeded, ${failed.length} failed.\n`);
  if (failed.length === 0) {
    console.log('Nothing to reconcile.');
    process.exit(0);
  }

  const now = new Date();
  const dateFrom = pacificDateMdY(now, hours > 24 ? -2 : -1);
  const dateTo = pacificDateMdY(now, 0);
  console.log(`asking SoftPro for every order ${dateFrom} -> ${dateTo} (one call, slow)...`);
  const started = Date.now();
  const details = await getOrderDetails({ dateFrom, dateTo });
  const took = Date.now() - started;

  if (!details.success || !details.data) {
    console.log(`\nLOOKUP FAILED after ${took}ms: ${details.error?.message ?? 'unknown'}`);
    console.log('NOTHING IS RECONCILED. Do not let anyone re-enter.');
    process.exit(1);
  }
  const all = (details.data as SoftProOrderDetailItem[]).filter((x) => x.OrderNumber);
  console.log(`  got ${all.length} order(s) with a number, in ${took}ms\n`);

  console.log('='.repeat(96));
  console.log('RECONCILIATION — what SoftPro has at each attempted address');
  console.log('='.repeat(96));

  let safeToReenter = 0;
  let exists = 0;
  const duplicates: string[] = [];
  const hubMisses: string[] = [];

  for (const f of failed) {
    const scored = all
      .map((row) => ({ row, m: matchWide(row, { address: f.address, city: f.city }) }))
      .filter((x) => x.m.hit);
    const matches = scored.map((x) => x.row);
    const missedByHub = scored.filter((x) => !x.m.viaHubMatcher).map((x) => x.row);

    const laterSuccess = attempts.filter((a) =>
      a !== f && a.success && a.address === f.address && a.city === f.city && a.at > f.at);

    console.log(`\n  ${f.at}   ${f.errorCategory ?? 'failed'} after ${f.ms ?? '?'}ms`);
    console.log(`  started : ${f.startedAt}   (the create ran from here)`);
    console.log(`  address : ${[f.address, f.city, f.state, f.zip].filter(Boolean).join(', ')}`);
    console.log(`  APN     : ${f.apn || '(none)'}`);

    if (matches.length === 0) {
      safeToReenter += 1;
      console.log('  SOFTPRO : NO FILE FOUND  ->  genuinely not created. SAFE TO RE-ENTER.');
      const key = streetKey(f.address);
      const near = all
        .map((row) => ({ row, k: streetKey(row.Address) }))
        .filter((x) => x.k && key && x.k.slice(0, 6) === key.slice(0, 6));
      console.log(`            hub street key: ${JSON.stringify(key)}`);
      if (near.length === 0) {
        console.log('            no vendor row shares the first six characters. The negative holds.');
      } else {
        console.log(`            ${near.length} near miss(es) — READ BEFORE RE-ENTERING:`);
        for (const n of near) {
          console.log(
            `              ${n.row.OrderNumber}  ${JSON.stringify(n.row.Address)} / `
            + `${JSON.stringify(n.row.City)}  key=${JSON.stringify(n.k)}`,
          );
        }
      }
    } else {
      exists += 1;
      console.log(`  SOFTPRO : ${matches.length} FILE(S) FOUND  ->  ${matches.map((m) => m.OrderNumber).join(', ')}`);
      console.log('            DO NOT RE-ENTER. A person links the hub to the existing file.');
      for (const m of matches) {
        console.log(`              ${m.OrderNumber}  ${m.Address ?? ''} / ${m.City ?? ''}  received ${m.ReceivedDate ?? '?'}`);
      }
      if (matches.length > 1) duplicates.push(`${f.address}, ${f.city} -> ${matches.map((m) => m.OrderNumber).join(', ')}`);
      if (missedByHub.length > 0) {
        const miss = missedByHub.map((m) => `${m.OrderNumber} (${m.Address ?? ''})`).join(', ');
        console.log(`  MATCHER : the hub's addressesMatch() MISSES ${miss}`);
        console.log("            It does not normalise street suffixes, so an operator would have");
        console.log('            been told this address was safe to re-enter. Needs its own fix.');
        hubMisses.push(`${f.address}, ${f.city} -> ${miss}`);
      }
    }

    if (laterSuccess.length > 0) {
      console.log(`  NOTE    : the hub later created this address successfully at ${laterSuccess.map((a) => a.at).join(', ')}.`);
      console.log('            The timed-out attempt above may have landed too — check for two files.');
    }
  }

  console.log(`\n${'='.repeat(96)}`);
  console.log(`  safe to re-enter (no file in SoftPro) : ${safeToReenter}`);
  console.log(`  already exists (do NOT re-enter)      : ${exists}`);
  if (hubMisses.length > 0) {
    console.log("\n  THE HUB'S OWN MATCHER WOULD HAVE MISSED THESE — a live bug in the");
    console.log('  recovery path, not just in this script:');
    for (const h of [...new Set(hubMisses)]) console.log(`    ${h}`);
  }
  if (duplicates.length > 0) {
    console.log('\n  MORE THAN ONE FILE AT ONE ADDRESS — look at these first:');
    for (const d of [...new Set(duplicates)]) console.log(`    ${d}`);
  }
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
