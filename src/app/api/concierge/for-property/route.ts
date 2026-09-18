import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge } from '@/lib/domain/concierge/access';
import { propertyRequestKey } from '@/lib/domain/concierge/claim';
import { alreadyHaveMessage, findProfileForProperty } from '@/lib/domain/concierge/already-have';

export const dynamic = 'force-dynamic';

/**
 * GET — do we already hold a profile for this address?
 *
 * READ ONLY. Asked by the New Report modal BEFORE the cost gate opens, so the
 * operator sees "we generated this on 12 September" while deciding, rather than
 * after clicking a button that says it will spend a credit.
 *
 * This is not the guard. It is the same question asked early, for the sake of
 * the person answering it; POST /api/concierge/profiles asks it again and is
 * what actually stops the charge, because a browser check protects nothing.
 */
const querySchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(3),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ existing: null });

  const existing = await findProfileForProperty(propertyRequestKey(parsed.data));
  return NextResponse.json({
    existing,
    message: existing ? alreadyHaveMessage(existing) : null,
  });
}
