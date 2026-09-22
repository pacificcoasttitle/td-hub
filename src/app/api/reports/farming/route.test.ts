import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The create route is thin by design: role check, upload checks, field checks,
// then the generator — whose own words come back to the operator. These tests
// hold it to that: every refusal says what to fix, and the generator's
// messages are passed through rather than replaced with a status code.

const { getSessionMock, gen } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  gen: {
    sales: vi.fn(), route: vi.fn(), county: vi.fn(),
  },
}));

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/domain/reports/generate', async () => {
  const options = await vi.importActual<typeof import('@/lib/domain/reports/options')>('@/lib/domain/reports/options');
  return {
    FARMING_COUNTIES: options.FARMING_COUNTIES,
    FARMING_WINDOWS: options.FARMING_WINDOWS,
    generateSalesActivity: gen.sales,
    generateCarrierRoute: gen.route,
    generateCountySales: gen.county,
  };
});

const { POST } = await import('./route');

const OK = { ok: true, reportId: 7, pdfStorageKey: 'k', pageCount: 1, quality: { rowsRead: 3, used: 3, rejected: 0, rejectedTypes: {} } };

function post(fields: Record<string, string>, file: File | null = new File(['Site City,Purchase Price,Property Type\nIrvine,1,rsfr'], 'oc.csv', { type: 'text/csv' })) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set('file', file);
  return POST(new NextRequest('http://localhost/api/reports/farming', { method: 'POST', body: form }));
}

const county = { type: 'county_sales', county: 'Orange', month: '2026-08', brandedToContactId: '22140' };

beforeEach(() => {
  getSessionMock.mockResolvedValue({ role: 'open_order_team', email: 'ops@pct.com' });
  for (const f of Object.values(gen)) { f.mockReset(); f.mockResolvedValue(OK); }
});

describe('who may create one', () => {
  it('turns away a request with no session', async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await post(county)).status).toBe(401);
  });

  it('turns away a role that may not create farming reports', async () => {
    getSessionMock.mockResolvedValue({ role: 'sales_rep', email: 'rep@pct.com' });
    const res = await post(county);
    expect(res.status).toBe(403);
    expect(gen.county).not.toHaveBeenCalled();
  });
});

describe('the upload', () => {
  it('asks for a file when none came', async () => {
    const res = await post(county, null);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('CSV file');
  });

  it('refuses a file over 5 MB before reading it', async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.csv', { type: 'text/csv' });
    expect((await post(county, big)).status).toBe(413);
    expect(gen.county).not.toHaveBeenCalled();
  });

  it('refuses a spreadsheet that was not saved as CSV, saying how to fix it', async () => {
    const xlsx = new File(['x'], 'oc.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const res = await post(county, xlsx);
    expect(res.status).toBe(415);
    expect((await res.json()).error).toContain('Save the spreadsheet as CSV');
  });
});

describe('the details', () => {
  it('refuses a county outside the six', async () => {
    const res = await post({ ...county, county: 'Kern' });
    expect(res.status).toBe(400);
    expect(gen.county).not.toHaveBeenCalled();
  });

  it('refuses a window other than 3, 6 or 12 months', async () => {
    const res = await post({ type: 'sales_activity', areaName: 'X', windowMonths: '4', windowEnd: '2026-08', brandedToContactId: '1' });
    expect((await res.json()).error).toBe('The window must be 3, 6 or 12 months.');
  });

  it('asks for the rep when none was chosen', async () => {
    const res = await post({ ...county, brandedToContactId: '' });
    expect(res.status).toBe(400);
  });
});

describe('the generator decides, and is quoted', () => {
  it('calls the generator for the type chosen, with the file text and the user', async () => {
    const res = await post(county);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ reportId: 7, type: 'county_sales', pageCount: 1 });
    expect(gen.county).toHaveBeenCalledWith(expect.objectContaining({
      county: 'Orange', month: '2026-08', brandedToContactId: 22140, createdBy: 'ops@pct.com',
      csv: 'Site City,Purchase Price,Property Type\nIrvine,1,rsfr',
    }));
    expect(gen.sales).not.toHaveBeenCalled();
    expect(gen.route).not.toHaveBeenCalled();
  });

  it('passes a refusal back word for word, as a 422, when nothing was written', async () => {
    gen.county.mockResolvedValue({ ok: false, reportId: null, stage: 'parse', message: 'The file has no column for: property type.' });
    const res = await post(county);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('The file has no column for: property type.');
  });

  it('returns the failed row\'s id when the failure came after the row, so the list can show it', async () => {
    gen.county.mockResolvedValue({ ok: false, reportId: 9, stage: 'store', message: 'The document rendered but could not be stored.' });
    const res = await post(county);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ reportId: 9, error: 'The document rendered but could not be stored.' });
  });

  it('never trusts a rep name from the browser — only the contact id reaches the generator', async () => {
    await post({ ...county, brandedToName: 'Somebody Else', brandedToEmail: 'x@evil.test' });
    const arg = gen.county.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('brandedToName');
    expect(arg).not.toHaveProperty('brandedToEmail');
  });
});
