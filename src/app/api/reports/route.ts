import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { REPORTS_PAGE_SIZE, listReports } from '@/lib/domain/reports/list';

export const dynamic = 'force-dynamic';

/**
 * The Reports list: four report types, one page.
 *
 * READ ONLY. Nothing here generates, sends, or spends — the one route that can
 * spend a credit is POST /api/concierge/profiles, and a test asserts it is the
 * only file importing the generator.
 *
 * The rows carry their latest DELIVERY ATTEMPT, read from report_deliveries, so
 * the Delivery cell needs no second fetch. A report with no attempt comes back
 * with `delivery: null` and must render as "never sent" — never as silence that
 * looks like success.
 */
const querySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  // All / Farming / Concierge. Active / Inactive is meaningless for a report.
  type: z.enum(['all', 'farming', 'concierge']).optional(),
  search: z.string().max(200).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid query' }, { status: 400 });
  }

  const result = await listReports({
    page: parsed.data.page,
    pageSize: parsed.data.pageSize ?? REPORTS_PAGE_SIZE,
    filter: parsed.data.type ?? 'all',
    search: parsed.data.search ?? null,
  });

  return NextResponse.json(result);
}
