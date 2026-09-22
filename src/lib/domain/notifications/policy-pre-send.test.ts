import { beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshBeforeSend } = vi.hoisted(() => ({ refreshBeforeSend: vi.fn() }));
vi.mock('./pre-send-refresh', () => ({ refreshBeforeSend }));

import { refreshPolicyLine } from './policy-delivery-send';

// A lender's policy goes TO escrow and CC the lender; the pre-send rule applies
// to both, the same way it does to a prelim.
const line = {
  to: { email: 'eo@oldescrow.com', name: 'Old Escrow', role: 'escrow_officer' },
  cc: [{ email: 'loans@oldlender.com', name: 'Old Lender', role: 'lender' }],
};

describe('refreshPolicyLine — the pre-send rule on a policy', () => {
  beforeEach(() => refreshBeforeSend.mockReset());

  it('asks SoftPro about the escrow TO and the lender CC, by policy role', async () => {
    refreshBeforeSend.mockResolvedValueOnce([
      { role: 'escrow', status: 'agrees', email: 'eo@oldescrow.com', name: 'Old Escrow' },
      { role: 'lender', status: 'agrees', email: 'loans@oldlender.com', name: 'Old Lender' },
    ]);

    const result = await refreshPolicyLine(7, '20018881-OCT', 'lender_policy', line, 'Title only');

    expect(refreshBeforeSend).toHaveBeenCalledWith({
      orderId: 7,
      fileNumber: '20018881-OCT',
      sendKind: 'lender_policy',
      orderType: 'Title only',
      candidates: [
        { role: 'escrow', email: 'eo@oldescrow.com', name: 'Old Escrow' },
        { role: 'lender', email: 'loans@oldlender.com', name: 'Old Lender' },
      ],
    });
    expect(result).toEqual({ ok: true, line });
  });

  it("DIFFERS: sends to SoftPro's lender, keeping the escrow TO that agreed", async () => {
    refreshBeforeSend.mockResolvedValueOnce([
      { role: 'escrow', status: 'agrees', email: 'eo@oldescrow.com', name: 'Old Escrow' },
      { role: 'lender', status: 'differs', email: 'closing@newlender.com', name: 'New Lender', ours: 'loans@oldlender.com' },
    ]);

    const result = await refreshPolicyLine(7, '20018881-OCT', 'lender_policy', line);

    expect(result).toEqual({
      ok: true,
      line: {
        to: line.to,
        cc: [{ email: 'closing@newlender.com', name: 'New Lender', role: 'lender' }],
      },
    });
  });

  it('SOFTPRO HAS NONE for a recipient the policy needs: fails closed, naming the role', async () => {
    refreshBeforeSend.mockResolvedValueOnce([
      { role: 'escrow', status: 'agrees', email: 'eo@oldescrow.com', name: 'Old Escrow' },
      { role: 'lender', status: 'softpro_has_none', ours: 'loans@oldlender.com' },
    ]);

    expect(await refreshPolicyLine(7, '20018881-OCT', 'lender_policy', line)).toEqual({ ok: false, missing: ['lender'] });
  });

  it('drops a CC that SoftPro has made the same address as the TO', async () => {
    refreshBeforeSend.mockResolvedValueOnce([
      { role: 'escrow', status: 'differs', email: 'loans@oldlender.com', name: 'Shared Inbox', ours: 'eo@oldescrow.com' },
      { role: 'lender', status: 'agrees', email: 'loans@oldlender.com', name: 'Old Lender' },
    ]);

    const result = await refreshPolicyLine(7, '20018881-OCT', 'lender_policy', line);

    expect(result).toMatchObject({ ok: true, line: { to: { email: 'loans@oldlender.com' }, cc: [] } });
  });

  it('UNREACHABLE: sends as it would have', async () => {
    refreshBeforeSend.mockResolvedValueOnce([
      { role: 'escrow', status: 'unreachable', email: 'eo@oldescrow.com', name: 'Old Escrow', error: 'timeout' },
      { role: 'lender', status: 'unreachable', email: 'loans@oldlender.com', name: 'Old Lender', error: 'timeout' },
    ]);

    expect(await refreshPolicyLine(7, '20018881-OCT', 'lender_policy', line)).toEqual({ ok: true, line });
  });
});
