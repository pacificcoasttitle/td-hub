import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, rerenderFarming, retryProfile } = vi.hoisted(() => ({
  getSessionMock: vi.fn(), rerenderFarming: vi.fn(), retryProfile: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/domain/reports/generate', () => ({ rerenderFarming }));
vi.mock('@/lib/domain/concierge/retry', () => ({ retryProfile }));

const { POST } = await import('./route');
const post = (type: string, id = '5') =>
  POST(new Request(`http://localhost/api/reports/${type}/${id}/retry`, { method: 'POST' }), { params: Promise.resolve({ type, id }) });

beforeEach(() => {
  getSessionMock.mockResolvedValue({ role: 'open_order_team', email: 'ops@pct.com' });
  rerenderFarming.mockReset().mockResolvedValue({ ok: true, reportId: 5, pdfStorageKey: 'k', pageCount: 2 });
  retryProfile.mockReset().mockResolvedValue({ ok: true, mode: 'resumed' });
});

describe('Try again', () => {
  it('re-renders a farming report from what it stores', async () => {
    const res = await post('county_sales');
    expect(res.status).toBe(200);
    expect(rerenderFarming).toHaveBeenCalledWith('county_sales', 5);
    expect(retryProfile).not.toHaveBeenCalled();
  });

  it('finishes or re-renders a concierge profile, and says nothing was charged', async () => {
    const res = await post('concierge_profile');
    expect(await res.json()).toMatchObject({ ok: true, mode: 'resumed', creditsCharged: 0 });
    expect(rerenderFarming).not.toHaveBeenCalled();
  });

  it('passes a farming refusal through with its reason', async () => {
    rerenderFarming.mockResolvedValue({ ok: false, reason: 'no_dataset', message: 'The uploaded file was never stored, so this report cannot be rebuilt from it. Create it again from the file.' });
    const res = await post('sales_activity');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('Create it again from the file');
  });

  it('refuses a concierge retry that would buy the property again, charging nothing', async () => {
    retryProfile.mockResolvedValue({ ok: false, reason: 'no_payload', message: 'This profile has no stored payload, so it cannot be finished without buying it again.' });
    const res = await post('concierge_profile');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ creditsCharged: 0 });
  });

  it('holds each family to its own role list', async () => {
    getSessionMock.mockResolvedValue({ role: 'sales_rep', email: 'r@pct.com' });
    expect((await post('county_sales')).status).toBe(403);
    expect((await post('concierge_profile')).status).toBe(403);
  });

  it('knows no other report type', async () => {
    expect((await post('anything_else')).status).toBe(404);
  });

  it('cannot reach the vendor: it imports neither the concierge generator nor the SiteX client', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'route.ts'), 'utf8');
    expect(src).not.toMatch(/generateConciergeProfile|integrations\/sitex/);
  });
});
