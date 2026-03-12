import { vendorSuccess } from '../types';
import type { VendorResult, VendorHealthResult } from '../types';
import type { RepFigures, LeaderboardResponse } from './types';

const MOCK_MONTH = new Date().toISOString().slice(0, 7);
const PRIOR = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();

function mockRepFigures(repName: string, month?: string): RepFigures {
  const m = month ?? MOCK_MONTH;
  return {
    rep: repName, month: m,
    yesterday: { date: new Date().toISOString().slice(0, 10), closed: 2, revenue: 4800, opens: 3 },
    mtd: { closed: 18, revenue: 42500, opens: 24, purchase: 10, refinance: 5, escrow: 2, tsg: 1 },
    prior: { month: PRIOR, closed: 22, revenue: 51200 },
    projected: 56000,
    closingRatio: { created: 30, closed: 18, ratio: 0.6, window: '90d' },
    ranking: { position: 3, totalReps: 12 },
    workingDays: { worked: 15, total: 22, remaining: 7 },
  };
}

const MOCK_LEADERBOARD: LeaderboardResponse = {
  month: MOCK_MONTH, priorMonth: PRIOR, totalReps: 12,
  leaderboard: [
    { rank: 1, salesRep: 'Sarah Chen', mtdClosed: 28, mtdRevenue: 68000, mtdOpens: 35, priorRevenue: 72000, purchaseCount: 18, refiCount: 6, escrowCount: 3, tsgCount: 1 },
    { rank: 2, salesRep: 'Mike Torres', mtdClosed: 24, mtdRevenue: 58000, mtdOpens: 30, priorRevenue: 61000, purchaseCount: 15, refiCount: 5, escrowCount: 3, tsgCount: 1 },
    { rank: 3, salesRep: 'Lisa Park', mtdClosed: 20, mtdRevenue: 47000, mtdOpens: 26, priorRevenue: 52000, purchaseCount: 12, refiCount: 4, escrowCount: 3, tsgCount: 1 },
    { rank: 4, salesRep: 'David Kim', mtdClosed: 18, mtdRevenue: 42500, mtdOpens: 24, priorRevenue: 48000, purchaseCount: 10, refiCount: 5, escrowCount: 2, tsgCount: 1 },
    { rank: 5, salesRep: 'Amy Nguyen', mtdClosed: 15, mtdRevenue: 36000, mtdOpens: 20, priorRevenue: 40000, purchaseCount: 8, refiCount: 4, escrowCount: 2, tsgCount: 1 },
  ],
};

export async function getRepFigures(repName: string, month?: string): Promise<VendorResult<RepFigures>> {
  return vendorSuccess(mockRepFigures(repName, month), { requestId: `mock-${crypto.randomUUID()}`, durationMs: 0 });
}

export async function getLeaderboard(_month?: string, _limit?: number): Promise<VendorResult<LeaderboardResponse>> {
  return vendorSuccess(MOCK_LEADERBOARD, { requestId: `mock-${crypto.randomUUID()}`, durationMs: 0 });
}

export async function healthCheck(): Promise<VendorHealthResult> {
  return { healthy: true, vendor: 'managers_report', latencyMs: 0 };
}
