import { vendorSuccess } from '../types';
import type { VendorResult, VendorHealthResult } from '../types';
import type { RepFigures, LeaderboardResponse, ClosingsResponse, ProductionHistoryResponse, TrendsResponse, ClientSummaryResponse } from './types';

const MOCK_MONTH = new Date().toISOString().slice(0, 7);
const PRIOR = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();

function mockRepFigures(repName: string, month?: string): RepFigures {
  const m = month ?? MOCK_MONTH;
  return {
    rep: repName, month: m,
    yesterday: { date: new Date().toISOString().slice(0, 10), closed: 2, revenue: 4800, opens: 3 },
    mtd: {
      closed: 18,
      revenue: 42500,
      opens: 24,
      purchase: 10,
      refinance: 5,
      escrow: 2,
      tsg: 1,
      repTotalProduction: 42500,
      titleRevenue: 37000,
      commissionableEscrow: 4000,
      tsgRevenue: 1500,
      openingsByType: {
        purchase: { count: 10 },
        refinance: { count: 9 },
        other: { count: 5 },
      },
      closingsByType: {
        purchase: { count: 10, revenue: 25000 },
        refinance: { count: 5, revenue: 12000 },
        escrow: { count: 2, revenue: 4000 },
        tsg: { count: 1, revenue: 1500 },
      },
    },
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

export async function getLeaderboard(_month?: string, _limit?: number, _year?: string): Promise<VendorResult<LeaderboardResponse>> {
  return vendorSuccess(MOCK_LEADERBOARD, { requestId: `mock-${crypto.randomUUID()}`, durationMs: 0 });
}

const MOCK_CLOSINGS: ClosingsResponse = {
  month: MOCK_MONTH,
  closings: [
    { fileNumber: 'PCT-2026-0142', salesRepName: 'Sarah Chen', closedDate: '2026-03-28', address: '1234 Oak Ave', city: 'Pasadena', state: 'CA', revenue: 3200 },
    { fileNumber: 'PCT-2026-0139', salesRepName: 'Mike Torres', closedDate: '2026-03-27', address: '567 Maple Dr', city: 'Glendale', state: 'CA', revenue: 2850 },
    { fileNumber: 'PCT-2026-0135', salesRepName: 'Sarah Chen', closedDate: '2026-03-25', address: '890 Pine St', city: 'Burbank', state: 'CA', revenue: 4100 },
    { fileNumber: 'PCT-2026-0131', salesRepName: 'Lisa Park', closedDate: '2026-03-24', address: '222 Elm Blvd', city: 'Arcadia', state: 'CA', revenue: 2600 },
    { fileNumber: 'PCT-2026-0128', salesRepName: 'David Kim', closedDate: '2026-03-22', address: '445 Cedar Ln', city: 'Monrovia', state: 'CA', revenue: 3750 },
  ],
};

const MOCK_PRODUCTION_HISTORY: ProductionHistoryResponse = {
  year: new Date().getFullYear(),
  months: [
    { month: 1, monthName: 'January', openings: 120, closings: 98, revenue: 245000, closingRatio: 81.7 },
    { month: 2, monthName: 'February', openings: 135, closings: 112, revenue: 278000, closingRatio: 83.0 },
    { month: 3, monthName: 'March', openings: 148, closings: 125, revenue: 312000, closingRatio: 84.5 },
  ],
};

const now = new Date();
const MOCK_TRENDS: TrendsResponse = {
  currentYear: {
    year: now.getFullYear(),
    months: [
      { month: 1, openings: 120, closings: 98, revenue: 245000 },
      { month: 2, openings: 135, closings: 112, revenue: 278000 },
      { month: 3, openings: 148, closings: 125, revenue: 312000 },
    ],
  },
  priorYear: {
    year: now.getFullYear() - 1,
    months: [
      { month: 1, openings: 110, closings: 88, revenue: 218000 },
      { month: 2, openings: 122, closings: 100, revenue: 249000 },
      { month: 3, openings: 130, closings: 108, revenue: 270000 },
      { month: 4, openings: 142, closings: 118, revenue: 295000 },
      { month: 5, openings: 155, closings: 130, revenue: 325000 },
      { month: 6, openings: 160, closings: 135, revenue: 338000 },
      { month: 7, openings: 148, closings: 122, revenue: 305000 },
      { month: 8, openings: 152, closings: 128, revenue: 320000 },
      { month: 9, openings: 140, closings: 115, revenue: 288000 },
      { month: 10, openings: 138, closings: 110, revenue: 275000 },
      { month: 11, openings: 125, closings: 102, revenue: 255000 },
      { month: 12, openings: 115, closings: 92, revenue: 230000 },
    ],
  },
};

export async function getClosings(_month?: number, _year?: number, _repName?: string): Promise<VendorResult<ClosingsResponse>> {
  return vendorSuccess(MOCK_CLOSINGS, { requestId: `mock-${crypto.randomUUID()}`, durationMs: 0 });
}

export async function getProductionHistory(_year?: number, _repName?: string): Promise<VendorResult<ProductionHistoryResponse>> {
  return vendorSuccess(MOCK_PRODUCTION_HISTORY, { requestId: `mock-${crypto.randomUUID()}`, durationMs: 0 });
}

export async function getTrends(_repName?: string): Promise<VendorResult<TrendsResponse>> {
  return vendorSuccess(MOCK_TRENDS, { requestId: `mock-${crypto.randomUUID()}`, durationMs: 0 });
}

const MOCK_CLIENT_SUMMARY: ClientSummaryResponse = {
  year: new Date().getFullYear(),
  totals: {
    totalClients: 10, repeatClients: 5, newClients: 3,
    topClientRevenue: 89500, avgDealsPerClient: 3.5,
    totalRevenue: 278600, totalDeals: 35,
  },
  clients: [
    { clientName: 'Rivera & Associates', companyName: 'Rivera Realty', deals: 8, revenue: 89500, lastCloseDate: '2026-03-28', firstDealDate: '2024-06-10', isNewThisYear: false, isRepeat: true, monthlyDeals: [2, 1, 3, 1, 0, 1, 0, 0, 0, 0, 0, 0] },
    { clientName: 'Karen Wu', companyName: 'Pinnacle Lending', deals: 5, revenue: 42200, lastCloseDate: '2026-03-22', firstDealDate: '2025-01-18', isNewThisYear: false, isRepeat: true, monthlyDeals: [1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0] },
    { clientName: 'James Thornton', companyName: 'Thornton Group', deals: 4, revenue: 34800, lastCloseDate: '2026-02-28', firstDealDate: '2025-04-03', isNewThisYear: false, isRepeat: true, monthlyDeals: [0, 2, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0] },
    { clientName: 'Priya Patel', companyName: 'Summit Mortgage', deals: 3, revenue: 27600, lastCloseDate: '2026-03-10', firstDealDate: '2024-11-20', isNewThisYear: false, isRepeat: true, monthlyDeals: [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0] },
    { clientName: 'David Ochoa', companyName: 'Pacific Edge Realty', deals: 3, revenue: 22400, lastCloseDate: '2026-03-05', firstDealDate: '2026-01-12', isNewThisYear: true, isRepeat: false, monthlyDeals: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { clientName: 'Lisa Nakamura', companyName: 'Golden State Escrow', deals: 3, revenue: 18800, lastCloseDate: '2026-02-14', firstDealDate: '2025-08-05', isNewThisYear: false, isRepeat: true, monthlyDeals: [0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
    { clientName: 'Marco Diaz', companyName: 'Diaz Home Loans', deals: 2, revenue: 15200, lastCloseDate: '2026-01-30', firstDealDate: '2025-09-22', isNewThisYear: false, isRepeat: false, monthlyDeals: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { clientName: 'Sarah Kim', companyName: 'Bright Future Lending', deals: 3, revenue: 12600, lastCloseDate: '2026-03-18', firstDealDate: '2026-02-01', isNewThisYear: true, isRepeat: false, monthlyDeals: [0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { clientName: 'Tom Bradley', companyName: 'Bradley & Co', deals: 2, revenue: 8200, lastCloseDate: '2025-11-15', firstDealDate: '2025-07-20', isNewThisYear: false, isRepeat: false, monthlyDeals: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { clientName: 'Ana Gutierrez', companyName: 'Sunset Escrow', deals: 2, revenue: 7300, lastCloseDate: '2025-12-01', firstDealDate: '2026-03-10', isNewThisYear: true, isRepeat: false, monthlyDeals: [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ],
};

export async function getClientSummary(_year?: number, _repName?: string): Promise<VendorResult<ClientSummaryResponse>> {
  return vendorSuccess(MOCK_CLIENT_SUMMARY, { requestId: `mock-${crypto.randomUUID()}`, durationMs: 0 });
}

export async function healthCheck(): Promise<VendorHealthResult> {
  return { healthy: true, vendor: 'managers_report', latencyMs: 0 };
}
