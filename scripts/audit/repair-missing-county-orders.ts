/**
 * Repair the four LIVE hub orders that were created with no county, got no
 * TitlePoint searches, and — because the silent branch never enqueued one —
 * got NO CONFIRMATION EMAIL AT ALL.
 *
 * Measured before the fix in #84:
 *
 *     hub-created orders, all time                40
 *     hit the silent branch                        9
 *     of those, got no confirmation                9
 *     normal path, got a confirmation             31 of 31
 *
 * Five of the nine are cancelled duplicates from the 2026-08-31 orphan
 * incident and are DELIBERATELY NOT TOUCHED — no confirmation on a cancelled
 * file is correct. The other four are live, in_process, one day old, and their
 * escrow companies were never told the order opened.
 *
 * PHASE 1 (this script):
 *   1. Set order_properties.county
 *   2. Fire autoTriggerTitlePoint — the same path hub create uses after local
 *      records exist, and the same one repair-create-order-orphans.ts uses.
 *
 * PHASE 2 is deliberately NOT here. The confirmation is enqueued only once all
 * three documents reach a terminal state, so the escrow company gets ONE
 * complete email with Legal & Vesting, Grant Deed and Taxes attached rather
 * than an empty one now and an apology later. See --enqueue-confirmation.
 *
 * Does NOT: write SoftPro, re-POST AddDocuments, cancel anything, or touch any
 * order outside REPAIR. Hard limit 10. Default is dry-run.
 *
 * Counties are not guessed. Each is corroborated by the parcel number already
 * on the order and by the city, both recorded below.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { orders, orderProperties, titlePointData, eventOutbox } from '@/lib/db/schema';
import { autoTriggerTitlePoint } from '@/lib/domain/titlepoint/auto-trigger';
import { getSetting } from '@/lib/domain/settings/service';

const APPLY = process.argv.includes('--apply');
const ENQUEUE = process.argv.includes('--enqueue-confirmation');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const MAX_ORDERS = 10;

/**
 * The four live orders, with the county each one is missing.
 *
 * Every county is corroborated twice — by the APN already stored on the order
 * and by the city — so none of these is inferred from an address alone.
 */
const REPAIR = [
  {
    orderId: 8136,
    file: '20021653-GLT',
    county: 'Los Angeles',
    // APN 4317-003-061 is an LA County parcel; the SiteX apn_lookup logged for
    // this order carries county "los angeles" in its own request.
    why: 'APN 4317-003-061 (LA format) + city Los Angeles',
  },
  {
    orderId: 8141,
    file: '20021658-GLT',
    county: 'Riverside',
    why: 'APN 906-771-036 + city Murrieta, which is Riverside County',
  },
  {
    orderId: 8147,
    file: '20021664-GLT',
    county: 'Mono',
    why: 'APN 031-061-045-000 + city Mammoth Lakes, which is Mono County',
  },
  {
    orderId: 8151,
    file: '20021668-OCT',
    county: 'San Bernardino',
    why: 'APN 0128-471-59-0000 + city Rialto, which is San Bernardino County',
  },
] as const;

if (REPAIR.length > MAX_ORDERS) {
  throw new Error(`REPAIR is ${REPAIR.length}; hard limit is ${MAX_ORDERS}`);
}

const TERMINAL = new Set(['result_ready', 'completed', 'complete', 'failed', 'error', 'no_result']);

interface Report {
  file: string;
  orderId: number;
  status: string | null;
  countyBefore: string;
  countyAfter: string | 'unchanged';
  titlePoint: string;
  documents: string;
  confirmation: string;
}

async function repairOne(target: (typeof REPAIR)[number]): Promise<Report> {
  const [order] = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber, status: orders.operationalStatus })
    .from(orders)
    .where(eq(orders.id, target.orderId))
    .limit(1);

  if (!order) {
    return {
      file: target.file, orderId: target.orderId, status: null,
      countyBefore: '—', countyAfter: '—', titlePoint: 'no_order',
      documents: '—', confirmation: '—',
    };
  }

  // REFUSE anything that is not a live order. A cancelled file must not be
  // revived by a repair script.
  if (String(order.status) !== 'in_process') {
    return {
      file: target.file, orderId: order.id, status: String(order.status),
      countyBefore: '—', countyAfter: 'REFUSED — not in_process',
      titlePoint: 'skipped', documents: '—', confirmation: '—',
    };
  }

  const [prop] = await db
    .select({
      id: orderProperties.id,
      address: orderProperties.address,
      city: orderProperties.city,
      state: orderProperties.state,
      county: orderProperties.county,
      apn: orderProperties.apn,
      fips: orderProperties.fips,
    })
    .from(orderProperties)
    .where(eq(orderProperties.orderId, order.id))
    .limit(1);

  if (!prop) {
    return {
      file: target.file, orderId: order.id, status: String(order.status),
      countyBefore: '—', countyAfter: 'no property row', titlePoint: 'skipped',
      documents: '—', confirmation: '—',
    };
  }

  const countyBefore = (prop.county ?? '').trim();

  // ─── 1. Set the county ────────────────────────────────────────────────────
  let countyAfter: string = 'unchanged';
  if (countyBefore === '') {
    if (APPLY) {
      await db.update(orderProperties)
        .set({ county: target.county, updatedAt: new Date() })
        .where(eq(orderProperties.id, prop.id));
    }
    countyAfter = target.county;
  }

  const county = countyBefore || target.county;

  // ─── 2. Fire TitlePoint ───────────────────────────────────────────────────
  const existing = await db
    .select({ id: titlePointData.id, searchType: titlePointData.searchType, status: titlePointData.status })
    .from(titlePointData)
    .where(eq(titlePointData.orderId, order.id));

  let titlePoint: string;
  if (existing.length > 0) {
    titlePoint = `already (${existing.length} rows)`;
  } else if (!APPLY) {
    titlePoint = 'would start';
  } else {
    const result = await autoTriggerTitlePoint(order.id, {
      address: prop.address ?? '',
      city: prop.city ?? '',
      state: prop.state ?? 'CA',
      county,
      apn: prop.apn || null,
      fips: prop.fips || null,
    });
    titlePoint = `initiated=${result.initiated} skipped=${result.skipped}`;
  }

  // ─── 3. Where are the documents? ──────────────────────────────────────────
  const after = await db
    .select({ searchType: titlePointData.searchType, status: titlePointData.status })
    .from(titlePointData)
    .where(eq(titlePointData.orderId, order.id));
  const documents = after.length === 0
    ? 'none yet'
    : after.map((r) => `${r.searchType}:${r.status}`).join(' ');
  const allTerminal = after.length > 0 && after.every((r) => TERMINAL.has(String(r.status)));

  // ─── 4. Confirmation, only when every document is terminal ────────────────
  //
  // Separate flag. The whole point of the repair is ONE complete email rather
  // than an empty one now and an apology later, so this must not run until the
  // documents it is meant to carry actually exist.
  let confirmation = 'not requested';
  if (ENQUEUE) {
    const [already] = await db
      .select({ id: eventOutbox.id })
      .from(eventOutbox)
      .where(eq(eventOutbox.orderId, order.id))
      .limit(1);
    if (already) confirmation = 'already enqueued — not duplicating';
    else if (!allTerminal) confirmation = `HELD — documents not terminal (${documents})`;
    else if (!APPLY) confirmation = 'would enqueue';
    else {
      const enabled = await getSetting('open_order_confirmation_enabled');
      if (enabled === 'false') confirmation = 'HELD — confirmations disabled by setting';
      else {
        await db.insert(eventOutbox).values({
          eventType: 'order.confirmation',
          orderId: order.id,
          payload: { repairedMissingCounty: true } as Record<string, unknown>,
        });
        confirmation = 'enqueued';
      }
    }
  }

  return {
    file: target.file, orderId: order.id, status: String(order.status),
    countyBefore: countyBefore || '(none)', countyAfter, titlePoint, documents, confirmation,
  };
}

(async () => {
  const targets = ONLY ? REPAIR.filter((r) => String(r.orderId) === ONLY) : REPAIR;
  if (targets.length === 0) {
    console.error(`--only ${ONLY} matched no order in REPAIR`);
    process.exit(1);
  }

  console.log(`Mode: ${APPLY ? 'APPLY (production writes)' : 'DRY-RUN (no writes)'}`);
  console.log(`Confirmation: ${ENQUEUE ? 'will enqueue when documents are terminal' : 'NOT touched'}`);
  console.log(`Targets: ${targets.map((t) => `${t.orderId}/${t.file}`).join(', ')}`);
  console.log('Cancelled duplicates are not in this list and must not be added.\n');

  for (const t of targets) {
    console.log(`── ${t.file}  order ${t.orderId}  county → ${t.county}`);
    console.log(`   basis: ${t.why}`);
    const r = await repairOne(t);
    console.log(`   status=${r.status}  county: ${r.countyBefore} → ${r.countyAfter}`);
    console.log(`   titlepoint: ${r.titlePoint}`);
    console.log(`   documents:  ${r.documents}`);
    console.log(`   confirmation: ${r.confirmation}\n`);
  }

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
