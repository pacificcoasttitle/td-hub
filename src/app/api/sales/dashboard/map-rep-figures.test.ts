import { describe, expect, it } from 'vitest';
import { mapRepFigures } from './route';
import type { RepFigures } from '@/lib/integrations/managers-report/types';
import { MOCK_PRODUCTION_BY_BRANCH_UNAVAILABLE } from '@/lib/integrations/managers-report/mock';

function baseFigures(overrides: Partial<RepFigures['mtd']> = {}): RepFigures {
  return {
    rep: 'Test Rep',
    month: '2026-06',
    yesterday: { date: '2026-06-01', closed: 0, revenue: 0, opens: 1 },
    mtd: {
      closed: 3,
      revenue: 300,
      opens: 5,
      purchase: 2,
      refinance: 1,
      escrow: 0,
      tsg: 0,
      repTotalProduction: 300,
      titleRevenue: 300,
      commissionableEscrow: 0,
      tsgRevenue: 0,
      repProductionByDealType: { purchase: 200, refinance: 100, other: 0 },
      productionByBranch: {
        Glendale: { closed: 1, revenue: 100 },
        Orange: { closed: 1, revenue: 100 },
        'Inland Empire': { closed: 1, revenue: 100 },
        Porterville: { closed: 0, revenue: 0 },
        TSG: { closed: 0, revenue: 0 },
        Unassigned: { closed: 0, revenue: 0 },
      },
      ...overrides,
    },
    prior: { month: '2026-05', closed: 1, revenue: 50 },
    projected: 400,
    closingRatio: { created: 5, closed: 3, ratio: 0.6, window: '90d' },
    ranking: { position: 1, totalReps: 5 },
    workingDays: { worked: 5, total: 22, remaining: 17 },
  };
}

describe('mapRepFigures productionByBranch', () => {
  it('preserves existing KPI fields including mtd.revenue', () => {
    const mapped = mapRepFigures(baseFigures());
    expect(mapped.mtd.revenue).toBe(300);
    expect(mapped.production.total).toBe(300);
    expect(mapped.openings.total).toBe(5);
    expect(mapped.closings.total).toBe(3);
    expect(mapped.yesterday.opens).toBe(1);
    expect(mapped.productionByBranch.available).toBe(true);
  });

  it('passes through MR available:false without crashing', () => {
    const mapped = mapRepFigures(baseFigures({
      productionByBranch: MOCK_PRODUCTION_BY_BRANCH_UNAVAILABLE,
    }));
    expect(mapped.productionByBranch).toEqual({
      available: false,
      reason: 'Mock: productionByBranch reconciliation failed upstream',
    });
    expect(mapped.mtd.revenue).toBe(300);
  });
});
