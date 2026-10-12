/**
 * READ-ONLY. GetOrderDetails for a 15-order sample of the 170 hub rows
 * missing address / city / state / zip / title officer. Raw fetch — does
 * not go through client.ts, so it does not write vendor_api_logs. GET only.
 *
 *   npx tsx --env-file=.env.local scripts/audit/measure-adddocuments-required-fields-sample.ts
 */
import { SOFTPRO_ENDPOINTS } from '../../src/lib/integrations/softpro/types';

type HubRow = {
  fileNumber: string;
  opened: string | null;
  source: 'softpro_sync' | 'manual_entry';
  hub: {
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    titleOfficer: boolean;
  };
};

const SAMPLE: HubRow[] = [
  { fileNumber: '99101054', opened: null, source: 'softpro_sync', hub: { address: null, city: null, state: null, zip: null, titleOfficer: true } },
  { fileNumber: '20004620-OCT', opened: '2025-06-26', source: 'softpro_sync', hub: { address: '1091 Bryan Avenue', city: 'Tustin', state: 'CA', zip: null, titleOfficer: true } },
  { fileNumber: '20006811-OCT', opened: '2025-08-22', source: 'softpro_sync', hub: { address: '443-445-445 1/2 Belden Avenue', city: 'Los Angeles', state: 'CA', zip: null, titleOfficer: false } },
  { fileNumber: '20008806-OCT', opened: '2025-10-06', source: 'softpro_sync', hub: { address: '2501 South El Camino Real #309', city: 'San Clemente', state: 'CA', zip: null, titleOfficer: true } },
  { fileNumber: '99100480', opened: '2025-10-07', source: 'softpro_sync', hub: { address: null, city: 'El Dorado Hills', state: 'CA', zip: null, titleOfficer: true } },
  { fileNumber: '20014132-GLT', opened: '2026-02-13', source: 'softpro_sync', hub: { address: '700 El Medio Avenue', city: 'Los Angeles, Pacific Palisades', state: 'CA', zip: null, titleOfficer: true } },
  { fileNumber: '20014377-ONT', opened: '2026-02-20', source: 'softpro_sync', hub: { address: '1707 Garvey Avenue #12', city: 'Alhambra', state: 'CA', zip: '91803', titleOfficer: false } },
  { fileNumber: '20015428-GLT', opened: '2026-03-17', source: 'softpro_sync', hub: { address: null, city: null, state: null, zip: null, titleOfficer: false } },
  { fileNumber: '20016053-GLT', opened: '2026-04-01', source: 'softpro_sync', hub: { address: null, city: null, state: null, zip: null, titleOfficer: false } },
  { fileNumber: '20017321-OCT', opened: '2026-05-05', source: 'softpro_sync', hub: { address: '19080 Valley Boulevard', city: 'Bloomington', state: 'CA', zip: null, titleOfficer: true } },
  { fileNumber: '20018350-OCT', opened: '2026-06-02', source: 'softpro_sync', hub: { address: null, city: null, state: null, zip: null, titleOfficer: false } },
  { fileNumber: '20018616-GLT', opened: '2026-06-08', source: 'manual_entry', hub: { address: '1358 5TH ST', city: 'LA VERNE', state: 'CA', zip: '91750', titleOfficer: false } },
  { fileNumber: '20020403-GLT', opened: '2026-07-28', source: 'manual_entry', hub: { address: '1358 5TH ST', city: 'LA VERNE', state: 'CA', zip: '91750', titleOfficer: false } },
  { fileNumber: '20020404-GLT', opened: '2026-07-28', source: 'manual_entry', hub: { address: '1358 5TH ST', city: 'LA VERNE', state: 'CA', zip: '91750', titleOfficer: false } },
  { fileNumber: '20020590-GLT', opened: '2026-08-03', source: 'softpro_sync', hub: { address: null, city: null, state: null, zip: null, titleOfficer: false } },
];

function present(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readDetails(fileNumber: string): Promise<Record<string, unknown>> {
  const base = process.env.SOFTPRO_API_URL;
  if (!base) throw new Error('SOFTPRO_API_URL not set');
  const root = base.endsWith('/') ? base : `${base}/`;
  const url = `${root}${SOFTPRO_ENDPOINTS.getOrderDetails}?${new URLSearchParams({
    DateFrom: '',
    DateTo: '',
    OrderNumber: fileNumber,
  }).toString()}`;
  const token = process.env.SOFTPRO_TOKEN;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-API-KEY': token } : {}) },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { httpStatus: res.status, error: 'non-JSON', snippet: text.slice(0, 240) };
  }

  const envelope = body as { Status?: number; Message?: string; data?: unknown };
  const rows = Array.isArray(envelope.data) ? envelope.data : [];
  const first = (rows[0] ?? null) as Record<string, unknown> | null;
  const contact = (first?.TitleOfficerContact ?? null) as Record<string, unknown> | null;
  return {
    httpStatus: res.status,
    envelopeStatus: envelope.Status ?? null,
    envelopeMessage: envelope.Message ?? null,
    resultCount: rows.length,
    Address: first?.Address ?? null,
    City: first?.City ?? null,
    State: first?.State ?? null,
    Zip: first?.Zip ?? null,
    TitleOfficer: first?.TitleOfficer ?? null,
    TitleOfficerContactName: contact?.Name ?? null,
    TitleOfficerContactLookup: contact?.LookupCode ?? null,
  };
}

function verdict(hub: HubRow['hub'], vendor: Record<string, unknown>): string {
  const vendorHas = {
    address: present(vendor.Address),
    city: present(vendor.City),
    state: present(vendor.State),
    zip: present(vendor.Zip),
    titleOfficer: present(vendor.TitleOfficer) || present(vendor.TitleOfficerContactName) || present(vendor.TitleOfficerContactLookup),
  };
  const hubHas = {
    address: present(hub.address),
    city: present(hub.city),
    state: present(hub.state),
    zip: present(hub.zip),
    titleOfficer: hub.titleOfficer,
  };
  const keys = ['address', 'city', 'state', 'zip', 'titleOfficer'] as const;
  const missingBoth = keys.filter((k) => !hubHas[k] && !vendorHas[k]);
  const oursDropped = keys.filter((k) => !hubHas[k] && vendorHas[k]);
  const theirsMissingOursHave = keys.filter((k) => hubHas[k] && !vendorHas[k]);
  if (vendor.resultCount === 0 || vendor.error) return 'vendor_unresolved';
  if (!oursDropped.length && !missingBoth.length && !theirsMissingOursHave.length) return 'both_complete_now';
  if (oursDropped.length && !missingBoth.length && !theirsMissingOursHave.length) return 'sync_gap_we_dropped';
  if (theirsMissingOursHave.length && !oursDropped.length) return 'hub_has_vendor_lacks';
  if (missingBoth.length && !oursDropped.length && !theirsMissingOursHave.length) return 'vendor_hole';
  if (oursDropped.length && missingBoth.length) return 'mixed_drop_and_hole';
  return 'mixed';
}

async function main() {
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(),
    source: 'GetOrderDetails raw fetch, no vendor_api_logs',
    n: SAMPLE.length,
  }));
  for (const row of SAMPLE) {
    const vendor = await readDetails(row.fileNumber);
    const line = {
      fileNumber: row.fileNumber,
      opened: row.opened,
      source: row.source,
      hub: row.hub,
      vendor: {
        address: vendor.Address ?? null,
        city: vendor.City ?? null,
        state: vendor.State ?? null,
        zip: vendor.Zip ?? null,
        titleOfficer: vendor.TitleOfficer ?? null,
        titleOfficerContact: vendor.TitleOfficerContactName ?? null,
        titleOfficerLookup: vendor.TitleOfficerContactLookup ?? null,
        resultCount: vendor.resultCount ?? 0,
        error: vendor.error ?? null,
        envelopeMessage: vendor.envelopeMessage ?? null,
      },
      verdict: verdict(row.hub, vendor),
    };
    console.log(JSON.stringify(line));
    await sleep(400);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
