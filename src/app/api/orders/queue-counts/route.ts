import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { buildScopeFilter } from '@/lib/domain/orders/scope';
import { getQueueCounts } from '@/lib/domain/orders/queue-counts';

// Counts change as orders arrive; nothing here is cacheable.
export const dynamic = 'force-dynamic';

/**
 * GET /api/orders/queue-counts
 *
 * The six rail counts, scoped exactly as the list is. Same session, same
 * predicate — see lib/domain/orders/scope.ts for why that matters.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const scopeFilter = await buildScopeFilter(session);
    const counts = await getQueueCounts(scopeFilter, new Date());
    return NextResponse.json(counts);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
