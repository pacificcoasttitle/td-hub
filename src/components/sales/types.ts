export interface SalesDashboardStats {
  openOrders: number;
  closedThisMonth: number;
  pipelineValue: number;
  assignedOrders: number;
  mtd: {
    revenue: number; closed: number;
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
  openedAt: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
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
