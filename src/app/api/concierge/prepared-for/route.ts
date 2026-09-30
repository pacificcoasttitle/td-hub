import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge } from '@/lib/domain/concierge/access';
import { preparedForSuggestions } from '@/lib/domain/concierge/prepared-for';

export const dynamic = 'force-dynamic';

const schema = z.object({
  q: z.string().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

/**
 * GET — names this operator has prepared profiles for.
 *
 * FREE. Reads concierge_profiles and nothing else; no vendor, no credit.
 *
 * SCOPED TO THE CALLER by session id, not by a parameter. A client list is
 * the rep's, and an id in the query string would let one operator read
 * another's book by editing a URL.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Bad query' }, { status: 400 });
  }

  const results = await preparedForSuggestions(session.id, parsed.data.q, parsed.data.limit);
  return NextResponse.json({ results });
}
