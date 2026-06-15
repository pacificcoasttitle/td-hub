export interface SalesDashboardStats {
  openOrders: number;
  closedThisMonth: number;
  pipelineValue: number;
  assignedOrders: number;
  openings: {
    total: number;
    byType: { purchase: number; refinance: number; other: number };
    /** Projected month-end openings count, when MR exposes it. */
    projected?: number;
  } | null;
  closings: {
    total: number;
    byType: {
      purchase: { count: number; revenue: number };
      refinance: { count: number; revenue: number };
      escrow: { count: number; revenue: number };
      tsg: { count: number; revenue: number };
    };
    /** Projected month-end closings count, when MR exposes it. */
    projected?: number;
  } | null;
  production: {
    total: number;
    title: number;
    escrow: number;
    tsg: number;
  } | null;
  mtd: {
    revenue: number; opens: number; closed: number;
    purchase: number; refinance: number; escrow: number; tsg: number;
    purchaseRevenue: number; refinanceRevenue: number; escrowRevenue: number; tsgRevenue: number;
  } | null;
  yesterday: { closed: number; revenue: number; opens: number } | null;
  prior: { closed: number; revenue: number } | null;
  ranking: { position: number; totalReps: number } | null;
  closingRatio: { closed: number; total: number } | null;
  projected: { revenue: number; workingDaysLeft: number } | null;
  orders: SalesOrder[];
  ordersTotal: number;
  ordersPage: number;
  ordersPageSize: number;
}

export interface SalesOrder {
  id: number;
  fileNumber: string;
  operationalStatus: string | null;
  transactionType: string | null;
  productType?: string | null;
  orderType?: string | null;
  openedAt: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  hasPrelim?: boolean;
  /** Assigned sales rep display name (list queries that join contacts). */
  salesRepName?: string | null;
}

export interface SalesRep {
  id: number;
  fullName: string;
  email: string;
}

export interface DailyRep {
  name: string;
  openings: number;
  closings: number;
  revenue: number;
}

export interface DailyData {
  reps: DailyRep[];
  totals: { openings: number; closings: number; revenue: number };
}
