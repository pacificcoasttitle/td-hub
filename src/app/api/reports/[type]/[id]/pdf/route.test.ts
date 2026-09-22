import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, getFarmingPdf, downloadFile } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getFarmingPdf: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/integrations/s3/client', () => ({ downloadFile }));
vi.mock('@/lib/domain/reports/stored', async () => {
  const actual = await vi.importActual<typeof import('@/lib/domain/reports/stored')>('@/lib/domain/reports/stored');
  return { ...actual, getFarmingPdf };
});

const { GET } = await import('./route');

const get = (type: string, id: string, qs = '') =>
  GET(new NextRequest(`http://localhost/api/reports/${type}/${id}/pdf${qs}`), { params: Promise.resolve({ type, id }) });

beforeEach(() => {
  getSessionMock.mockResolvedValue({ role: 'admin', email: 'a@pct.com' });
  getFarmingPdf.mockReset();
  downloadFile.mockReset();
  getFarmingPdf.mockResolvedValue({ ok: true, key: 'reports/county_sales/3/report-x.pdf', filename: 'Orange-County-August-2026.pdf' });
  downloadFile.mockResolvedValue({ success: true, data: Buffer.from('%PDF-1.3 test') });
});

describe('the farming PDF route', () => {
  it('serves the stored PDF, privately, under a name a person can read', async () => {
    const res = await get('county_sales', '3');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="Orange-County-August-2026.pdf"');
  });

  it('attaches rather than inlines when asked to download', async () => {
    const res = await get('county_sales', '3', '?download=1');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment;/);
  });

  it('finds the file from the type and id — never from a key the browser sends', async () => {
    await get('county_sales', '3', '?key=reports/other/secret.pdf');
    expect(getFarmingPdf).toHaveBeenCalledWith('county_sales', 3);
    expect(downloadFile).toHaveBeenCalledWith('reports/county_sales/3/report-x.pdf');
  });

  it('does not serve a concierge profile or anything else through this door', async () => {
    const res = await get('concierge_profile', '3');
    expect(res.status).toBe(404);
    expect(getFarmingPdf).not.toHaveBeenCalled();
  });

  it('turns away a role that may not open farming reports', async () => {
    getSessionMock.mockResolvedValue({ role: 'sales_rep', email: 'r@pct.com' });
    expect((await get('county_sales', '3')).status).toBe(403);
  });

  it('says a failed report has no document, rather than a bare 404', async () => {
    getFarmingPdf.mockResolvedValue({ ok: false, reason: 'no_document', status: 'failed' });
    const res = await get('county_sales', '3');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('This report failed to generate, so there is no document.');
  });

  it('says so when storage cannot produce the file', async () => {
    downloadFile.mockResolvedValue({ success: false });
    expect((await get('county_sales', '3')).status).toBe(502);
  });
});
