import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, listReports } = vi.hoisted(() => ({ getSessionMock: vi.fn(), listReports: vi.fn() }));
vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/domain/reports/list', () => ({ REPORTS_PAGE_SIZE: 25, listReports }));

const { GET } = await import('./route');
const get = (qs = '') => GET(new NextRequest(`http://localhost/api/sales/reports${qs}`));

beforeEach(() => {
  getSessionMock.mockResolvedValue({ role: 'sales_rep', email: 'mneveu@pct.com', contactId: 22140 });
  listReports.mockReset().mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
});

describe('a rep\'s own reports', () => {
  it('asks for the reports branded to the signed-in rep, farming only', async () => {
    expect((await get()).status).toBe(200);
    expect(listReports).toHaveBeenCalledWith(expect.objectContaining({ forRepContactId: 22140, filter: 'farming' }));
  });

  it('takes the rep from the session, never from the query', async () => {
    await get('?forRepContactId=999&contactId=999');
    expect(listReports).toHaveBeenCalledWith(expect.objectContaining({ forRepContactId: 22140 }));
  });

  it('is for sales roles only', async () => {
    getSessionMock.mockResolvedValue({ role: 'open_order_team', email: 'o@pct.com', contactId: 5 });
    expect((await get()).status).toBe(403);
  });

  it('says so, rather than showing an empty list, when the account has no linked contact', async () => {
    getSessionMock.mockResolvedValue({ role: 'sales_rep', email: 'x@pct.com', contactId: null });
    const res = await get();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('not linked');
    expect(listReports).not.toHaveBeenCalled();
  });
});
