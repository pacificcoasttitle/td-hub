import { afterEach, describe, expect, it } from 'vitest';
import {
  CONCIERGE_GENERATE_ROLES, CONCIERGE_USAGE_ROLES, canGenerateConcierge,
  canViewConciergeUsage, conciergeEnabled, denialMessage, denyConciergeGeneration,
} from './access';

const original = process.env.CONCIERGE_PROFILE_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.CONCIERGE_PROFILE_ENABLED;
  else process.env.CONCIERGE_PROFILE_ENABLED = original;
});
const setFlag = (v: string | undefined) => {
  if (v === undefined) delete process.env.CONCIERGE_PROFILE_ENABLED;
  else process.env.CONCIERGE_PROFILE_ENABLED = v;
};

// The gate exists because the previous one was an accident. These assert it
// FAILS CLOSED in every direction — a gate that only proves it can open is the
// same mistake in a new coat.

describe('the flag defaults to off', () => {
  it.each([undefined, '', '  ', 'false', 'FALSE', '0', 'yes', 'on', 'enabled', 'null'])(
    'CONCIERGE_PROFILE_ENABLED=%o is OFF', (v) => {
      setFlag(v as string | undefined);
      expect(conciergeEnabled()).toBe(false);
    });

  it.each(['true', 'TRUE', 'True', ' true '])('only an explicit %o is on', (v) => {
    setFlag(v);
    expect(conciergeEnabled()).toBe(true);
  });

  it('an UNSET variable can never mean enabled — that is the whole point', () => {
    setFlag(undefined);
    expect(conciergeEnabled()).toBe(false);
    expect(denyConciergeGeneration('super_admin')).toBe('feature_off');
  });
});

describe('generation roles', () => {
  it('the nine open_order_team operators can generate', () => {
    expect(canGenerateConcierge('open_order_team')).toBe(true);
  });

  it('admin and super_admin can, so it can be exercised and supported', () => {
    expect(canGenerateConcierge('admin')).toBe(true);
    expect(canGenerateConcierge('super_admin')).toBe(true);
  });

  it.each(['sales_rep', 'sales_manager', 'escrow_assistant', 'title_production',
    'cs_admin', 'client', 'title_officer', 'escrow_officer', '', null, undefined,
    'OPEN_ORDER_TEAM', 'open order team'])('%o cannot', (r) => {
    expect(canGenerateConcierge(r as string)).toBe(false);
  });

  it('47 sales reps are the largest role in the hub and are NOT operators', () => {
    // Guards against widening the gate by reflex to "everyone in the hub".
    expect(canGenerateConcierge('sales_rep')).toBe(false);
  });
});

describe('usage reporting is a different, narrower audience', () => {
  it('is not the same list as generation', () => {
    expect([...CONCIERGE_USAGE_ROLES]).not.toEqual([...CONCIERGE_GENERATE_ROLES]);
  });

  it('open_order_team generates but does not see spend reporting', () => {
    expect(canGenerateConcierge('open_order_team')).toBe(true);
    expect(canViewConciergeUsage('open_order_team')).toBe(false);
  });

  it('cs_admin sees spend but cannot generate', () => {
    expect(canViewConciergeUsage('cs_admin')).toBe(true);
    expect(canGenerateConcierge('cs_admin')).toBe(false);
  });
});

describe('both conditions are checked together', () => {
  it('flag off beats any role', () => {
    setFlag('false');
    for (const r of [...CONCIERGE_GENERATE_ROLES]) {
      expect(denyConciergeGeneration(r), r).toBe('feature_off');
    }
  });

  it('flag on still refuses a role that is not an operator', () => {
    setFlag('true');
    expect(denyConciergeGeneration('sales_rep')).toBe('role');
    expect(denyConciergeGeneration(null)).toBe('role');
  });

  it('permits only when BOTH hold', () => {
    setFlag('true');
    expect(denyConciergeGeneration('open_order_team')).toBeNull();
  });

  it('a disabled feature does not read as the operator lacking permission', () => {
    expect(denialMessage('feature_off')).not.toMatch(/permission/i);
    expect(denialMessage('role')).toMatch(/permission/i);
  });
});
