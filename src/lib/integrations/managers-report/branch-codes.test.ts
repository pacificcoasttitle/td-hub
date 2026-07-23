import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRANCH_CODES,
  mapProductionByBranch,
  orderedLocationCodes,
  branchCodeFromDbCode,
} from './branch-codes';

const validMap = {
  Glendale: { closed: 2, revenue: 2125 },
  Orange: { closed: 12, revenue: 32015 },
  'Inland Empire': { closed: 1, revenue: 6257 },
  Porterville: { closed: 0, revenue: 0 },
  TSG: { closed: 0, revenue: 0 },
  Unassigned: { closed: 0, revenue: 0 },
};

const MTD = 2125 + 32015 + 6257; // 40397 — Richard Bohn fixture

describe('mapProductionByBranch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps MR display names to suffix codes and ties to mtd.revenue', () => {
    const result = mapProductionByBranch(validMap, MTD);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.locations.GLT.revenue).toBe(2125);
    expect(result.locations.OCT.revenue).toBe(32015);
    expect(result.locations.ONT.revenue).toBe(6257);
    expect(result.locations.PRV.revenue).toBe(0);
    expect(result.tsg.revenue).toBe(0);
    expect(result.unassigned.revenue).toBe(0);
    const sum =
      BRANCH_CODES.reduce((s, c) => s + result.locations[c].revenue, 0)
      + result.tsg.revenue
      + result.unassigned.revenue;
    expect(sum).toBe(MTD);
  });

  it('accepts Orange County and Ontario name variants', () => {
    const result = mapProductionByBranch({
      Glendale: { closed: 0, revenue: 0 },
      'Orange County': { closed: 1, revenue: 100 },
      Ontario: { closed: 1, revenue: 50 },
      Porterville: { closed: 0, revenue: 0 },
      TSG: { closed: 0, revenue: 0 },
      Unassigned: { closed: 0, revenue: 0 },
    }, 150);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.locations.OCT.revenue).toBe(100);
    expect(result.locations.ONT.revenue).toBe(50);
  });

  it('UNKNOWN key → console.error + unavailable (never drop/fold dollars)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = mapProductionByBranch({
      ...validMap,
      'Mystery Branch': { closed: 1, revenue: 999 },
    }, MTD + 999);

    expect(result).toEqual({
      available: false,
      reason: 'Unknown productionByBranch key: Mystery Branch',
    });
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining('unknown MR branch key'),
    );
  });

  it('handles { available:false } BEFORE iteration (no crash)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = mapProductionByBranch(
      { available: false, reason: 'reconciliation failed upstream' },
      40_397,
    );
    expect(result).toEqual({
      available: false,
      reason: 'reconciliation failed upstream',
    });
    expect(err).not.toHaveBeenCalled();
  });

  it('broken fixture that does not tie → unavailable', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = mapProductionByBranch(validMap, MTD + 1);
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toMatch(/does not tie/);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('reconciliation failed'));
  });

  it('keeps TSG and Unassigned structurally separate from locations', () => {
    const result = mapProductionByBranch({
      Glendale: { closed: 0, revenue: 100 },
      Orange: { closed: 0, revenue: 0 },
      'Inland Empire': { closed: 0, revenue: 0 },
      Porterville: { closed: 0, revenue: 0 },
      TSG: { closed: 2, revenue: 500 },
      Unassigned: { closed: 1, revenue: 25 },
    }, 625);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(Object.keys(result.locations)).toEqual(['GLT', 'OCT', 'ONT', 'PRV']);
    expect(result.tsg).toEqual({ closed: 2, revenue: 500 });
    expect(result.unassigned).toEqual({ closed: 1, revenue: 25 });
    expect('TSG' in result.locations).toBe(false);
  });
});

describe('orderedLocationCodes / branchCodeFromDbCode', () => {
  it('home-first for Meza=GLT and Neil=OCT', () => {
    expect(orderedLocationCodes('GLT')[0]).toBe('GLT');
    expect(orderedLocationCodes('OCT')[0]).toBe('OCT');
    expect(orderedLocationCodes(null)).toEqual(['GLT', 'OCT', 'ONT', 'PRV']);
  });

  it('maps branches.code only (never name)', () => {
    expect(branchCodeFromDbCode('GLT')).toBe('GLT');
    expect(branchCodeFromDbCode('oct')).toBe('OCT');
    expect(branchCodeFromDbCode('Glendale')).toBeNull();
    expect(branchCodeFromDbCode(null)).toBeNull();
  });
});
