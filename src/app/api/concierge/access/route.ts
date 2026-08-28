import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge, conciergeEnabled } from '@/lib/domain/concierge/access';

export const dynamic = 'force-dynamic';

/**
 * What the UI is allowed to show. Both conditions are evaluated on the SERVER —
 * the feature flag is never sent to the browser as a variable it could read or
 * a build-time constant it could be compiled with.
 *
 * This only decides what is DRAWN. Every route re-checks; hiding a button is
 * not a permission model.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ canGenerate: false, featureOn: false });
  return NextResponse.json({
    canGenerate: canGenerateConcierge(session.role),
    featureOn: conciergeEnabled(),
  });
}
