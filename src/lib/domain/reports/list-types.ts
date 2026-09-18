/**
 * The Reports list, minus the database.
 *
 * ─── WHY THIS FILE IS SEPARATE FROM list.ts ─────────────────────────────────
 *
 * The list PAGE is a client component and needs the labels, the row shape and
 * the page size. list.ts imports the postgres client, and one value import from
 * a client component pulled the whole driver into the browser bundle: the
 * production build failed on `Can't resolve 'fs'` and nothing deployed for
 * fifteen hours (commit 251432b). Typecheck and the test suite both passed —
 * neither of them bundles.
 *
 * So: anything the browser may import lives HERE and imports nothing. The
 * query lives in list.ts. A test asserts this file stays free of the database.
 */

export const REPORT_TYPES = ['sales_activity', 'carrier_route', 'county_sales', 'concierge_profile'] as const;
export type ReportType = typeof REPORT_TYPES[number];

export const FARMING_TYPES: readonly ReportType[] = ['sales_activity', 'carrier_route', 'county_sales'];

export type ReportFilter = 'all' | 'farming' | 'concierge';

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  sales_activity: 'Sales Activity',
  carrier_route: 'Carrier Route Analysis',
  county_sales: 'County Sales',
  concierge_profile: 'Concierge Profile',
};

export interface ReportDeliverySummary {
  outcome: 'delivered' | 'failed';
  attemptedAt: string;
  recipientName: string | null;
  recipientEmail: string;
}

export interface ReportListRow {
  type: ReportType;
  id: number;
  typeLabel: string;
  /** "Dataset" for the farming three; what the credit did for Concierge. */
  sourceLine: string;
  subject: string | null;
  subjectDetail: string | null;
  settings: string | null;
  brandedToName: string | null;
  status: string;
  createdAt: string;
  createdBy: string | null;
  /** The latest ATTEMPT. Null means never sent, and must not read as success. */
  delivery: ReportDeliverySummary | null;
}

export interface ReportListResult {
  rows: ReportListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const REPORTS_PAGE_SIZE = 25;

/**
 * The Report column's sub-line.
 *
 * Concierge is the only type that spends, so its sub-line says what the money
 * did — including that a failed generation cost nothing, which is the question
 * anyone looking at a failed row asks first.
 */
export function sourceLineFor(type: ReportType, status: string, creditsCharged: number | null): string {
  if (type !== 'concierge_profile') return 'Dataset';
  if (status === 'failed') return creditsCharged && creditsCharged > 0 ? 'Failed · 1 credit spent' : 'Failed · no credit charged';
  if (status === 'pending' || status === 'retrieved') return 'Generating';
  return creditsCharged && creditsCharged > 0 ? `${creditsCharged} credit spent` : 'No credit charged';
}
