import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOrderDetailsMock } = vi.hoisted(() => ({
  getOrderDetailsMock: vi.fn(),
}));

vi.mock('@/lib/integrations/softpro', () => ({
  getOrderDetails: (...args: unknown[]) => getOrderDetailsMock(...args),
}));

import {
  addressesMatch,
  CREATE_TIMEOUT_LOOKUP_FAILED,
  findCreatedSoftProFile,
  ORDER_NOT_CREATED_SAFE_TO_RETRY,
  softProCreatedDoNotReenter,
} from './recover-created-file';

describe('operator copy — one treatment for timeout and post-200', () => {
  it('Found names the file, forbids re-entry, and gives the operator somewhere to go', () => {
    const msg = softProCreatedDoNotReenter('20021683-OCT');
    expect(msg).toBe(
      'SoftPro created this file: 20021683-OCT, but the hub did not record it. '
      + 'Do not re-enter the order — it already exists. '
      + 'Contact support with this file number so the two can be reconciled.',
    );
  });

  it('does not tell the operator to do something the product cannot do', () => {
    // "Repair it." shipped for a while. There is no repair screen, no repair
    // route and no repair action — the only consumers relabel a button and
    // lock Create. An imperative with nothing behind it is worse than no
    // instruction, because the operator goes looking.
    expect(softProCreatedDoNotReenter('20021683-OCT')).not.toMatch(/repair it/i);
  });

  it('Not found is safe to retry', () => {
    expect(ORDER_NOT_CREATED_SAFE_TO_RETRY).toBe('The order was not created. Safe to try again.');
  });

  it('lookup failure is not "aborted" and is not "safe to try again"', () => {
    expect(CREATE_TIMEOUT_LOOKUP_FAILED).not.toMatch(/abort/i);
    expect(CREATE_TIMEOUT_LOOKUP_FAILED).not.toBe(ORDER_NOT_CREATED_SAFE_TO_RETRY);
  });
});

describe('addressesMatch', () => {
  it('matches the timeout-orphan street even when SoftPro adds a suffix', () => {
    expect(addressesMatch(
      { Address: '15181 Jackson St', City: 'Midway City' },
      { address: '15181 Jackson Street', city: 'Midway City' },
    )).toBe(true);
  });

  it('rejects a different street on the same city', () => {
    expect(addressesMatch(
      { Address: '21975 Trailway Ln', City: 'Lake Forest' },
      { address: '15181 Jackson St', city: 'Lake Forest' },
    )).toBe(false);
  });
});

describe('findCreatedSoftProFile', () => {
  beforeEach(() => {
    getOrderDetailsMock.mockReset();
  });

  it('uses GetOrderDetails — GetOrders has no address', async () => {
    getOrderDetailsMock.mockResolvedValue({
      success: true,
      data: [{
        OrderNumber: '20021683-OCT',
        Address: '15181 Jackson St',
        City: 'Midway City',
        ReceivedDate: '2026-09-01T01:43:37',
      }],
    });

    const found = await findCreatedSoftProFile({
      address: '15181 Jackson St',
      city: 'Midway City',
      now: new Date('2026-09-01T16:00:00Z'),
    });

    expect(found).toEqual({ kind: 'found', fileNumber: '20021683-OCT' });
    expect(getOrderDetailsMock).toHaveBeenCalledWith({
      dateFrom: '08-31-2026',
      dateTo: '09-01-2026',
    });
  });

  it('Not found when SoftPro has no matching address', async () => {
    getOrderDetailsMock.mockResolvedValue({
      success: true,
      data: [{ OrderNumber: '20021600-OCT', Address: '1 Other St', City: 'Irvine' }],
    });

    await expect(findCreatedSoftProFile({ address: '15181 Jackson St', city: 'Midway City' }))
      .resolves.toEqual({ kind: 'not_found' });
  });

  it('lookup_failed when the vendor call fails — not treated as not-found', async () => {
    getOrderDetailsMock.mockResolvedValue({ success: false, error: { message: 'down' } });

    await expect(findCreatedSoftProFile({ address: '15181 Jackson St' }))
      .resolves.toEqual({ kind: 'lookup_failed' });
  });

  it('picks the newest of several matches at the same address', async () => {
    getOrderDetailsMock.mockResolvedValue({
      success: true,
      data: [
        { OrderNumber: '20021684-OCT', Address: '21975 Trailway Ln', City: 'Lake Forest', ReceivedDate: '2026-09-01T01:49:00' },
        { OrderNumber: '20021687-OCT', Address: '21975 Trailway Ln', City: 'Lake Forest', ReceivedDate: '2026-09-01T02:00:50' },
      ],
    });

    await expect(findCreatedSoftProFile({ address: '21975 Trailway Ln', city: 'Lake Forest' }))
      .resolves.toEqual({ kind: 'found', fileNumber: '20021687-OCT' });
  });
});
