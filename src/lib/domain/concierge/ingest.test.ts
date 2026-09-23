import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// ─── The row shape the database will accept ─────────────────────────────────
//
// `concierge_comps_exclusion_shape` says a comparable is either SELECTED with a
// display position and no reason, or NOT SELECTED with a reason and no
// position. There is no third state, and that is the whole defensibility of the
// stored set: every comparable either appears at a position or carries why it
// does not.
//
// The first real generation wrote candidates undecided — `selected = false,
// exclusion_reason = NULL` — and Postgres refused all 25 rows AFTER the credit
// had been spent. These tests run the real insert through a fake database and
// check every row against the constraint, so the shape is asserted where it is
// produced rather than only where it is stored.

const { inserted } = vi.hoisted(() => ({ inserted: { rows: [] as Record<string, unknown>[] } }));

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({ values: (rows: Record<string, unknown>[]) => {
      inserted.rows.push(...(Array.isArray(rows) ? rows : [rows]));
      return Promise.resolve();
    } }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
  },
}));
vi.mock('@/lib/integrations/s3/client', () => ({
  uploadFile: vi.fn(async () => ({ success: true })),
  downloadFile: vi.fn(async () => ({ success: false })),
}));

const { ingestPayload } = await import('./generate');
const { COMP_KEY } = await import('./normalize');

/** One comparable as SiteX returns it, with only the fields the filter reads. */
function comp(position: number, over: Record<string, unknown> = {}) {
  return {
    Proximity: 0.3, SiteAddress: `${position} TEST ST`, SiteCity: 'LA VERNE',
    SiteState: 'CA', SiteZip: '91750', APN: `000-000-${position}`,
    RecordingDate: '20260801', SalePrice: 500000, PricePerSQFT: 500,
    BuildingArea: 1000, Bedrooms: 3, Baths: 2, YearBuilt: 1960, LotSize: 5000,
    UseCodeDescription: 'Single Family Residential',
    DocumentNumber: `26-${position}`, DocumentType: 'Grant Deed',
    Latitude: 34.1, Longitude: -117.78,
    ...over,
  };
}

function payload(comps: Array<ReturnType<typeof comp>>) {
  return {
    Feed: {
      PropertyProfile: {
        APN: '8381-000-000',
        PropertyCharacteristics: {
          UseCodeDescription: 'Single Family Residential',
          BuildingArea: 1000, Bedrooms: 3, Baths: 2,
        },
      },
      // The key SiteX actually uses, as normalize.ts records it.
      [COMP_KEY]: comps,
    },
  };
}

/** The constraint, in JavaScript. Fails the way Postgres fails. */
function violatesShape(row: Record<string, unknown>): boolean {
  const selected = row.selected === true;
  const reason = row.exclusionReason ?? null;
  const position = row.displayPosition ?? null;
  return selected
    ? !(reason === null && position !== null)
    : !(reason !== null && position === null);
}

async function ingest(comps: Array<ReturnType<typeof comp>>) {
  inserted.rows = [];
  await ingestPayload(1, payload(comps) as { Feed?: Record<string, unknown> }, new Date('2026-09-18T00:00:00Z'));
  return inserted.rows.filter((r) => 'sourcePosition' in r && 'selected' in r);
}

describe('every comparable is written already decided', () => {
  it('writes no row the check constraint would refuse', async () => {
    // The exact failure of 2026-09-18: 25 rows, all of them undecided.
    const rows = await ingest([comp(0), comp(1), comp(2)]);
    expect(rows.length).toBe(3);
    expect(rows.filter(violatesShape)).toEqual([]);
  });

  it('gives a selected comparable a position and no reason', async () => {
    const rows = await ingest([comp(0)]);
    expect(rows[0]).toMatchObject({ selected: true, exclusionReason: null, displayPosition: 1 });
  });

  it('gives an excluded comparable the rule that rejected it, and no position', async () => {
    // Nine years old against a 12-month window.
    const rows = await ingest([comp(0, { RecordingDate: '20170801' })]);
    expect(rows[0]).toMatchObject({ selected: false, displayPosition: null });
    expect(rows[0]!.exclusionReason).toBe('sale_too_old');
  });

  it('never writes an undecided row even when everything is excluded', async () => {
    const rows = await ingest([comp(0, { SalePrice: 0 }), comp(1, { UseCodeDescription: 'Condominium' })]);
    expect(rows.every((r) => r.selected === false)).toBe(true);
    expect(rows.filter(violatesShape)).toEqual([]);
    expect(rows.map((r) => r.exclusionReason)).toEqual(['no_sale_price', 'use_code']);
  });

  it('handles a payload with no comparables at all rather than throwing', async () => {
    expect(await ingest([])).toEqual([]);
  });
});

describe('the order of operations', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const strip = (f: string) => readFileSync(join(HERE, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('filters before it inserts, not after', async () => {
    const src = strip('generate.ts');
    const filterAt = src.indexOf('selectComps(');
    const insertAt = src.indexOf('insert(conciergeProfileComps)');
    expect(filterAt).toBeGreaterThan(-1);
    expect(filterAt).toBeLessThan(insertAt);
  });

  it('keeps the call and the ingest separable, so a spent credit can be resumed', () => {
    // The payload is in storage before ingest runs; completing a profile from it
    // must never need the vendor again.
    expect(strip('generate.ts')).toContain('export async function ingestPayload');
  });

  it('re-render leaves a row alone rather than writing it undecided', () => {
    expect(strip('render.ts')).toContain('if (!d) continue;');
  });
});

// ─── The audit record has to keep being written ─────────────────────────────
//
// concierge_profile_transfers is written on every generation and read by
// NOTHING — the document re-normalises transfers from the stored payload. It
// was kept deliberately (docs/tickets/GENERATE_RERENDER_PAIRS.md): payloads
// are retained indefinitely today, but that is a state and not a policy, and
// if a lifecycle rule is ever added for storage cost this table is the only
// surviving record of what SiteX said about transfers on the day we charged.
//
// A TABLE NOBODY READS IS A TABLE NOBODY NOTICES LOSING. A refactor drops the
// insert, no test fails, no document changes, and the record has a hole in it
// starting from a date nobody can identify — which is worse than not having
// the table, because it still looks complete.
//
// So the write is asserted here, where nothing else would miss it.
describe('the transfer audit rows are written', () => {
  const transfer = (position: number, over: Record<string, unknown> = {}) => ({
    RecordingDate: '20260801', DocumentType: 'Grant Deed', TransactionType: 'Transfer',
    // RecorderDocumentNumber, not DocumentNumber — the key normalize.ts reads.
    // The first version of this fixture used the wrong one and the assertion
    // below caught it, which is the only reason it is worth having.
    RecorderDocumentNumber: `26-${position}`, ...over,
  });

  async function ingestWithTransfers(transfers: Record<string, unknown>[]) {
    inserted.rows = [];
    const p = payload([comp(1)]) as { Feed: Record<string, unknown> };
    p.Feed.TransferHistory = transfers;
    await ingestPayload(1, p as { Feed?: Record<string, unknown> }, new Date('2026-09-18T00:00:00Z'));
    // Transfer rows carry a recording date and no `selected` — comps carry
    // `selected`, and the profile row carries neither.
    return inserted.rows.filter((r) => 'sourcePosition' in r && !('selected' in r));
  }

  it('writes one row per transfer the payload carried', async () => {
    const rows = await ingestWithTransfers([transfer(0), transfer(1), transfer(2)]);
    expect(rows, 'no transfer rows were written — the audit record this table exists to be '
      + 'has a hole in it, and nothing else in the system would have failed')
      .toHaveLength(3);
  });

  it('keeps the document number, which is what makes a row an audit record', async () => {
    const rows = await ingestWithTransfers([transfer(0, { RecorderDocumentNumber: '26-0551234' })]);
    expect(rows[0]).toMatchObject({ documentNumber: '26-0551234' });
  });

  it('writes nothing when the payload carried no transfers, rather than a placeholder', async () => {
    expect(await ingestWithTransfers([])).toHaveLength(0);
  });
});
