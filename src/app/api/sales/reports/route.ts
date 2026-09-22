import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { REPORTS_PAGE_SIZE, listReports } from '@/lib/domain/reports/list';

export const dynamic = 'force-dynamic';

/**
 * A rep's own reports — the list reps had in legacy at /sales-reports/{id}.
 *
 * READ ONLY, and filtered to the reports branded to the signed-in rep's
 * contact: the same id the operator's rep picker writes onto the report, so a
 * report appears in exactly one rep's list. Farming reports only, as legacy's
 * list was. Nothing here creates, sends or notifies.
 */
const querySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'sales_rep' && session.role !== 'sales_manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Every rep account has a linked contact today (checked 2026-09-22). One
  // without cannot be matched to anything branded, and says so rather than
  // showing an empty list that reads as "you have no reports".
  if (session.contactId === null) {
    return NextResponse.json({ error: 'Your account is not linked to a sales rep contact, so your reports cannot be found. Ask an administrator to link it.' }, { status: 409 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 });

  return NextResponse.json(await listReports({
    page: parsed.data.page,
    pageSize: REPORTS_PAGE_SIZE,
    filter: 'farming',
    search: parsed.data.search ?? null,
    forRepContactId: session.contactId,
  }));
}
