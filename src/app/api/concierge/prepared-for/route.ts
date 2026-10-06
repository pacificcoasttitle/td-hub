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

  // session.EMAIL, not session.id.
  //
  // This was session.id — a Supabase UUID — while the generate route writes
  // `createdBy: session.email`. The two never matched: 0 rows against the UUID,
  // 9 against the email, so the endpoint returned an empty list for every user
  // on every keystroke from the day it shipped. The feature looked like a
  // scoping question and was a typing one.
  //
  // THE COMMENT BELOW IT WAS CONFIDENTLY ABOUT THE WRONG THING. It explained at
  // length why one rep must not see another's client list, while the query
  // matched nobody at all. A guard that excludes everyone is not a strict
  // guard, it is a broken query wearing a guard's explanation.
  const results = await preparedForSuggestions(session.email, parsed.data.q, parsed.data.limit);
  return NextResponse.json({ results });
}
