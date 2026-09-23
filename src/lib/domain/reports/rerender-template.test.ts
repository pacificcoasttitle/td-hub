import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── The staleness refusal, asserted by behaviour ───────────────────────────
//
// This replaces three source-text assertions that checked rerenderFarming
// CONTAINED a template comparison. Grepping for the presence of a check is a
// proxy; calling the function and seeing it refuse is the thing itself — and
// unlike the grep, this keeps working when the code is refactored, which is
// the whole complaint about source-reading guards.
//
// WHAT IS BEING PROTECTED: the stored figures were computed for the document
// that existed when the row was written. Rendering them through today's
// document means a field the new layout reads may simply not be in the stored
// object, and because these are jsonb it arrives as `undefined` and prints as
// a blank rather than failing. Concierge already relies on the version stamp
// for this; farming stored the same column and never read it.

const { row } = vi.hoisted(() => ({ row: { value: null as Record<string, unknown> | null } }));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(row.value ? [row.value] : []) }) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    insert: () => ({ values: () => Promise.resolve() }),
  },
}));
vi.mock('@/lib/integrations/s3/client', () => ({
  uploadFile: vi.fn(async () => ({ success: true })),
  downloadFile: vi.fn(async () => ({ success: false })),
}));

const { rerenderFarming, TEMPLATE_FOR } = await import('./generate');

/** A failed county-sales row, otherwise complete enough to render. */
const failedRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  status: 'failed',
  datasetStorageKey: 'reports/county_sales/1/dataset.csv',
  templateVersion: TEMPLATE_FOR.county_sales,
  datasetRows: 1908, datasetUsed: 1908, datasetRejected: 0, rejectedTypes: {},
  brandedToName: 'Maria Lopez', brandedToTitle: null, brandedToPhone: null, brandedToEmail: null,
  county: 'Riverside', month: '2025-08-01',
  cities: [{ city: 'Riverside', houses: { sold: 198, medianPrice: 672_500 }, condos: { sold: 20, medianPrice: 455_614 } }],
  totals: { houses: { sold: 1610, medianPrice: 625_000 }, condos: { sold: 298, medianPrice: 481_000 } },
  ...over,
});

beforeEach(() => { row.value = null; });

describe('re-rendering a report built for a different template', () => {
  it('refuses, naming both versions', async () => {
    row.value = failedRow({ templateVersion: 'cs-v0' });
    const out = await rerenderFarming('county_sales', 1);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe('stale_template');
    expect(out.ok === false && out.message).toContain('cs-v0');
    expect(out.ok === false && out.message).toContain(TEMPLATE_FOR.county_sales);
  });

  it('tells the operator what to do instead, rather than only refusing', async () => {
    row.value = failedRow({ templateVersion: 'cs-v0' });
    const out = await rerenderFarming('county_sales', 1);
    expect(out.ok === false && out.message).toMatch(/create it again from its dataset/i);
  });

  it('refuses a row with no template recorded at all', async () => {
    // An older row predating the stamp. Unknown is not a match.
    row.value = failedRow({ templateVersion: null });
    const out = await rerenderFarming('county_sales', 1);
    expect(out.ok === false && out.reason).toBe('stale_template');
    expect(out.ok === false && out.message).toContain('unknown');
  });

  it('proceeds past the check when the template matches', async () => {
    // The fixture is on the CURRENT template, so the staleness check must not
    // be what stops it — proving the refusal above is about the version and
    // not about every row.
    row.value = failedRow();
    const out = await rerenderFarming('county_sales', 1);
    expect(out.ok === false && out.reason).not.toBe('stale_template');
  });
});

describe('stored figures that are not the shape the document reads', () => {
  it('refuses by name rather than rendering a blank page', async () => {
    // `as never` used to make this undefined at render time: half the county
    // table would print empty with no error anywhere.
    row.value = failedRow({ totals: { houses: { sold: 1, medianPrice: 2 } } });
    const out = await rerenderFarming('county_sales', 1);
    expect(out.ok === false && out.reason).toBe('bad_figures');
    expect(out.ok === false && out.message).toContain('totals.condos');
  });

  it('refuses when the city list is not a list', async () => {
    row.value = failedRow({ cities: null });
    const out = await rerenderFarming('county_sales', 1);
    expect(out.ok === false && out.reason).toBe('bad_figures');
    expect(out.ok === false && out.message).toContain('cities');
  });
});

describe('the checks that came before it still hold', () => {
  it('refuses a report that did not fail', async () => {
    row.value = failedRow({ status: 'generated' });
    expect((await rerenderFarming('county_sales', 1)).ok).toBe(false);
  });

  it('refuses a report whose dataset was never stored', async () => {
    row.value = failedRow({ datasetStorageKey: null });
    const out = await rerenderFarming('county_sales', 1);
    expect(out.ok === false && out.reason).toBe('no_dataset');
  });

  it('refuses a report that does not exist', async () => {
    row.value = null;
    const out = await rerenderFarming('county_sales', 1);
    expect(out.ok === false && out.reason).toBe('not_found');
  });
});
