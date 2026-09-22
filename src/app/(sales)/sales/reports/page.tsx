'use client';

import { SalesReportsList } from '@/components/sales/sales-reports-list';

/**
 * A rep's own farming reports — the list reps had in legacy.
 *
 * This route used to be a "Report downloads coming soon" shell over an
 * endpoint that did not exist. It now reads GET /api/sales/reports, filtered
 * on the server to the signed-in rep.
 */
export default function SalesReportsPage() {
  return <SalesReportsList />;
}
