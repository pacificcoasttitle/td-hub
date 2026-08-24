import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getConciergeUsage } from '@/lib/domain/concierge/usage';

const ALLOWED_ROLES = ['super_admin', 'admin', 'cs_admin'];

/**
 * Concierge spend, counted by us.
 *
 * SiteX's production /credits endpoint returns INT32_MAX — a sentinel, not a
 * balance — so this is the only place the run rate is visible before an invoice
 * lands. sitex_search_id on each row is what reconciles a line on that invoice
 * back to a specific report.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const usage = await getConciergeUsage();
  return NextResponse.json({
    ...usage,
    note: 'Counted from concierge_profiles. SiteX does not expose a production balance.',
  });
}
