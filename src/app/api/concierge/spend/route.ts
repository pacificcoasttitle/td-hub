import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge } from '@/lib/domain/concierge/access';
import { getSpendSnapshot } from '@/lib/domain/concierge/profiles';

export const dynamic = 'force-dynamic';

/**
 * The two numbers the cost gate shows, fetched when the gate opens so they are
 * current rather than whatever they were at page load.
 *
 * Available to anyone who can generate — an operator about to spend should see
 * the run rate. The fuller admin breakdown stays at /api/admin/concierge/usage.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getSpendSnapshot());
}
