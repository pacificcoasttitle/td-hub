import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_REGISTRY } from '@/lib/domain/settings/service';
import {
  isPolicyDeliveryEnabled,
  isPolicyDispatchEvent,
  POLICY_DELIVERY_ENABLED_SETTING,
} from './policy-delivery-flag';

const { getSetting } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
}));

vi.mock('@/lib/domain/settings/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domain/settings/service')>();
  return { ...actual, getSetting };
});

describe('policy_delivery_enabled', () => {
  it('is registered off, like tessa_prelim_enabled', () => {
    const policy = SETTINGS_REGISTRY.find((s) => s.key === POLICY_DELIVERY_ENABLED_SETTING);
    const prelim = SETTINGS_REGISTRY.find((s) => s.key === 'tessa_prelim_enabled');
    expect(policy?.defaultValue).toBe('false');
    expect(prelim?.defaultValue).toBe('false');
    expect(policy?.type).toBe('boolean');
  });

  it('is off when the row is missing, false, or anything other than true', async () => {
    getSetting.mockResolvedValueOnce(null);
    expect(await isPolicyDeliveryEnabled()).toBe(false);
    getSetting.mockResolvedValueOnce('false');
    expect(await isPolicyDeliveryEnabled()).toBe(false);
    getSetting.mockResolvedValueOnce('TRUE');
    expect(await isPolicyDeliveryEnabled()).toBe(false);
  });

  it('is on only for the exact string true', async () => {
    getSetting.mockResolvedValueOnce('true');
    expect(await isPolicyDeliveryEnabled()).toBe(true);
    expect(getSetting).toHaveBeenCalledWith(POLICY_DELIVERY_ENABLED_SETTING);
  });
});

describe('isPolicyDispatchEvent', () => {
  it('covers the customer send, the fail-closed alert, and the webhook event', () => {
    expect(isPolicyDispatchEvent('policy.delivery')).toBe(true);
    expect(isPolicyDispatchEvent('policy.delivery.unresolved')).toBe(true);
    expect(isPolicyDispatchEvent('order.document.received', { category: 'policy' })).toBe(true);
    expect(isPolicyDispatchEvent('order.document.received', { category: 'supplement' })).toBe(true);
    expect(isPolicyDispatchEvent('order.document.received', { category: 'prelim' })).toBe(false);
    expect(isPolicyDispatchEvent('order.confirmation')).toBe(false);
  });
});
