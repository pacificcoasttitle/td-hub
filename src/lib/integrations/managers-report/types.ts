// ─── Rep Figures (GET /api/td/rep/{repName}) ────────────────────────────────

export interface RepDaySnapshot {
  date: string;
  closed: number;
  revenue: number;
  opens: number;
}

export interface RepMtdFigures {
  closed: number;
  revenue: number;
  opens: number;
  purchase: number;
  refinance: number;
  escrow: number;
  tsg: number;
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
