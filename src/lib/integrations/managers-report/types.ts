// ─── Rep Figures (GET /api/td/rep/{repName}) ────────────────────────────────

export interface RepDaySnapshot {
  date: string;
  closed: number;
  revenue: number;
  opens: number;
}

export type MtdBreakdown = number | { count: number; revenue: number };

export interface RepMtdFigures {
  closed: number;
  revenue: number;
  opens: number;
  purchase: MtdBreakdown;
  refinance: MtdBreakdown;
  escrow: MtdBreakdown;
  tsg: MtdBreakdown;
}

export interface RepPriorFigures {
  month: string;
  closed: number;
  revenue: number;
}

export interface ClosingRatio {
  created: number;
  closed: number;
  ratio: number;
  window: string;
}

export interface WorkingDays {
  worked: number;
  total: number;
  remaining: number;
}

export interface RepRanking {
  position: number;
  totalReps: number;
}

export interface RepFigures {
  rep: string;
  month: string;
  yesterday: RepDaySnapshot;
  mtd: RepMtdFigures;
  prior: RepPriorFigures;
  projected: number;
  closingRatio: ClosingRatio;
  ranking: RepRanking;
  workingDays: WorkingDays;
}

// ─── Leaderboard (GET /api/td/leaderboard) ──────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  salesRep: string;
  mtdClosed: number;
  mtdRevenue: number;
  mtdOpens: number;
  priorRevenue: number;
  purchaseCount: number;
  refiCount: number;
  escrowCount: number;
  tsgCount: number;
}

export interface LeaderboardResponse {
  month: string;
  priorMonth: string;
  totalReps: number;
  leaderboard: LeaderboardEntry[];
}

// ─── Closings (GET /api/td/closings) ────────────────────────────────────────

export interface ClosingsEntry {
  fileNumber: string;
  salesRepName: string;
  closedDate: string;
  address: string;
  city: string;
  state: string;
  revenue: number;
}

export interface ClosingsResponse {
  month: string;
  closings: ClosingsEntry[];
}

// ─── Production History (GET /api/td/production-history) ─────────────────────

export interface ProductionMonth {
  month: number;
  monthName: string;
  openings: number;
  closings: number;
  revenue: number;
  closingRatio: number;
}

export interface ProductionHistoryResponse {
  year: number;
  months: ProductionMonth[];
}

// ─── Trends (GET /api/td/trends) ────────────────────────────────────────────

export interface TrendMonth {
  month: number;
  openings: number;
  closings: number;
  revenue: number;
}

export interface TrendYear {
  year: number;
  months: TrendMonth[];
}

export interface TrendsResponse {
  currentYear: TrendYear;
  priorYear: TrendYear;
}
