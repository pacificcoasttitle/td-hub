/**
 * Repair the KEEP list from docs/tickets/CREATE_ORDER_ORPHANS_2026-08-31.md.
 *
 * SoftPro already has these files. Hub either has no property row (varchar
 * 200-then-insert-fail) or a softpro_sync shell (60s create abort). This
 * script:
 *   1. Inserts a missing property row via attachMissingOrderProperty —
 *      the same builder createLocalRecords uses — from the logged SoftPro
 *      create payload. No SiteX re-fetch. No guessed fields.
 *   2. Fires autoTriggerTitlePoint when county is known and TitlePoint has
 *      not started. Same path hub create uses after local records exist.
 *
 * Does NOT: re-POST AddDocuments, enqueue order.confirmation, enable invite,
 * write SoftPro, cancel/void, or touch any file outside KEEP_FILES.
 *
 * Hard limit 50. Explicit file list. --apply to write. Default is dry-run.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { orders, orderProperties, titlePointData, vendorApiLogs } from '@/lib/db/schema';
import {
  attachMissingOrderProperty,
  propertyFromSoftProCreatePayload,
  type SoftProCreatePropertyDetails,
} from '@/lib/domain/orders/create-order';
import { autoTriggerTitlePoint } from '@/lib/domain/titlepoint/auto-trigger';

const APPLY = process.argv.includes('--apply');

/** Keep / repair only. Matches Select, not the original first-of-set list. */
export const KEEP_FILES = [
  '20021662-OCT', // varchar — 18556 Rex Ln (first of set)
  '20021675-GLT', // varchar — 6154 Whittier Blvd (single)
  '20021676-GLT', // timeout single — 2570 Rudder Avenue
  '20021681-GLT', // Josephine survivor — Select kept 681, cancelled 680
  '20021683-OCT', // Jackson survivor — Select kept 683, cancelled 669 and 679
  '20021684-OCT', // timeout keep — 21975 Trailway Ln
  '20021695-GLT', // timeout keep — 82639 Crest Ave
  '20021701-GLT', // timeout keep — 56320 Bonanza Dr
] as const;

/** Named so a --apply typo cannot widen the blast. Do not un-cancel these. */
const CANCEL_FILES = [
  '20021663-OCT',
  '20021669-OCT', // Jackson original first; cancelled in Select
  '20021677-OCT',
  '20021678-OCT',
  '20021679-OCT', // Jackson; confirmed cancelled in Select
  '20021680-GLT', // Josephine original first; cancelled in Select
  '20021685-OCT',
  '20021686-OCT',
  '20021687-OCT',
  '20021696-GLT',
  '20021702-GLT',
  '20021703-GLT',
] as const;

const MAX_FILES = 50;

type KeepFile = (typeof KEEP_FILES)[number];

if (KEEP_FILES.length > MAX_FILES) {
  throw new Error(`KEEP_FILES is ${KEEP_FILES.length}; hard limit is ${MAX_FILES}`);
}

async function loadCreatePayload(fileNumber: string): Promise<{
  payload: { propertyDetails?: SoftProCreatePropertyDetails } | null;
}> {
  const rows = await db
    .select({
      payload: sql<{ propertyDetails?: SoftProCreatePropertyDetails } | null>`request_meta->'payload'`,
    })
    .from(vendorApiLogs)
    .where(and(
      eq(vendorApiLogs.vendor, 'softpro'),
      eq(vendorApiLogs.operation, 'create_order'),
      sql`response_meta->>'orderNumber' = ${fileNumber}`,
    ))
    .orderBy(vendorApiLogs.startedAt)
    .limit(1);
  return rows[0] ?? { payload: null };
}

type Report = {
  file: string;
  orderId: number | null;
  source: string | null;
  status: string | null;
  property: 'inserted' | 'already_present' | 'skipped' | 'missing_payload' | 'canceled';
  titlePoint: 'started' | 'already' | 'no_county' | 'skipped' | 'canceled';
  note: string;
};

async function repairOne(fileNumber: KeepFile): Promise<Report> {
  if ((CANCEL_FILES as readonly string[]).includes(fileNumber)) {
    throw new Error(`${fileNumber} is on CANCEL_FILES — refuse`);
  }

  const [order] = await db
    .select({
      id: orders.id,
      source: orders.source,
      operationalStatus: orders.operationalStatus,
    })
    .from(orders)
    .where(eq(orders.fileNumber, fileNumber))
    .limit(1);

  if (!order) {
    return {
      file: fileNumber,
      orderId: null,
      source: null,
      status: null,
      property: 'skipped',
      titlePoint: 'skipped',
      note: 'no hub order row',
    };
  }

  if (order.operationalStatus === 'canceled') {
    return {
      file: fileNumber,
      orderId: order.id,
      source: order.source,
      status: order.operationalStatus,
      property: 'canceled',
      titlePoint: 'canceled',
      note: 'hub already canceled — do not un-cancel, do not repair',
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

  let property: Report['property'] = prop ? 'already_present' : 'skipped';
  let county = (prop?.county ?? '').trim();
  let address = (prop?.address ?? '').trim();
  let city = (prop?.city ?? '').trim();
  let state = (prop?.state ?? 'CA').trim() || 'CA';
  let apn = prop?.apn ?? null;
  let fips = prop?.fips ?? null;

  if (!prop) {
    const log = await loadCreatePayload(fileNumber);
    const pd = log.payload?.propertyDetails;
    if (!pd) {
      return {
        file: fileNumber,
        orderId: order.id,
        source: order.source,
        status: order.operationalStatus,
        property: 'missing_payload',
        titlePoint: 'skipped',
        note: 'no logged SoftPro create payload — will not guess property fields',
      };
    }
    const mapped = propertyFromSoftProCreatePayload(pd);
    if (APPLY) {
      property = await attachMissingOrderProperty(order.id, { property: mapped.property }, null, mapped.enriched);
    } else {
      property = 'inserted';
    }
    county = mapped.enriched.county;
    address = mapped.property.address;
    city = mapped.property.city;
    state = mapped.property.state;
    apn = mapped.enriched.apn || null;
    fips = mapped.enriched.fips;
  }

  const [tp] = await db
    .select({ id: titlePointData.id })
    .from(titlePointData)
    .where(eq(titlePointData.orderId, order.id))
    .limit(1);

  let titlePoint: Report['titlePoint'] = 'skipped';
  if (tp) {
    titlePoint = 'already';
  } else if (!county) {
    titlePoint = 'no_county';
  } else if (APPLY) {
    const result = await autoTriggerTitlePoint(order.id, {
      address,
      city,
      state,
      county,
      apn,
      fips,
    });
    titlePoint = result.initiated > 0 ? 'started' : result.skipped ? 'skipped' : 'no_county';
  } else {
    titlePoint = 'started';
  }

  return {
    file: fileNumber,
    orderId: order.id,
    source: order.source,
    status: order.operationalStatus,
    property,
    titlePoint,
    note: '',
  };
}

(async () => {
  console.log(`Mode: ${APPLY ? 'APPLY (production writes: property insert + TitlePoint)' : 'DRY-RUN (no writes)'}`);
  console.log(`Keep list (${KEEP_FILES.length}, limit ${MAX_FILES}): ${KEEP_FILES.join(', ')}`);
  console.log('Invite off. No AddDocuments. No SoftPro cancel.\n');

  const reports: Report[] = [];
  for (const file of KEEP_FILES) {
    const report = await repairOne(file);
    reports.push(report);
    console.log(
      `${file}  order=${report.orderId ?? '—'}  ${report.source ?? '—'}  ${report.status ?? '—'}  `
      + `property=${report.property}  titlepoint=${report.titlePoint}`
      + (report.note ? `  ${report.note}` : ''),
    );
  }

  const inserted = reports.filter((r) => r.property === 'inserted').length;
  const tp = reports.filter((r) => r.titlePoint === 'started').length;
  console.log(`\n${APPLY ? 'Wrote' : 'Would write'}: property rows ${inserted}, TitlePoint starts ${tp}`);

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
