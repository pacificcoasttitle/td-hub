import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, notifyRep } = vi.hoisted(() => ({ getSessionMock: vi.fn(), notifyRep: vi.fn() }));

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/domain/reports/notify', () => ({ notifyRep }));

const { POST } = await import('./route');

const post = (type: string, id: string, body?: string) => POST(
  new Request(`http://localhost/api/reports/${type}/${id}/notify`, { method: 'POST', body }),
  { params: Promise.resolve({ type, id }) },
);

beforeEach(() => {
  getSessionMock.mockResolvedValue({ role: 'open_order_team', email: 'ops@pct.com' });
  notifyRep.mockReset();
  notifyRep.mockResolvedValue({ ok: true, deliveryId: 31, recipientName: 'Mark Neveu', recipientEmail: 'mneveu@pct.com' });
});

describe('the Notify rep route', () => {
  it('notifies, and says who was notified', async () => {
    const res = await post('county_sales', '3');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: 'sent', deliveryId: 31, recipientEmail: 'mneveu@pct.com' });
    expect(notifyRep).toHaveBeenCalledWith({ type: 'county_sales', id: 3, sentBy: 'ops@pct.com' });
  });

  it('takes no recipient from the request — it cannot be pointed at an outside address', async () => {
    await post('county_sales', '3', JSON.stringify({ to: 'agent@elsewhere.test', recipientEmail: 'agent@elsewhere.test' }));
    expect(notifyRep).toHaveBeenCalledWith({ type: 'county_sales', id: 3, sentBy: 'ops@pct.com' });
  });

  it('is only for farming reports', async () => {
    expect((await post('concierge_profile', '3')).status).toBe(404);
    expect(notifyRep).not.toHaveBeenCalled();
  });

  it('turns away a role that may not use it', async () => {
    getSessionMock.mockResolvedValue({ role: 'sales_rep', email: 'r@pct.com' });
    expect((await post('county_sales', '3')).status).toBe(403);
  });

  it('answers a refusal — nothing attempted — with 409 and the reason', async () => {
    notifyRep.mockResolvedValue({ ok: false, deliveryId: null, reason: 'no_email', message: 'Mark Neveu has no email address on the report, so there is nowhere to send it.' });
    const res = await post('county_sales', '3');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('no email address');
  });

  it('answers a failed attempt with 502 and the row that records it', async () => {
    notifyRep.mockResolvedValue({ ok: false, deliveryId: 31, reason: 'provider', message: 'The email was not sent: bounced.' });
    const res = await post('county_sales', '3');
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ outcome: 'failed', deliveryId: 31 });
  });
});
