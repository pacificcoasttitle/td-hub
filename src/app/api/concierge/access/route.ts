import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import {
  canGenerateConcierge, conciergeEnabled, hazardPreviewAvailable,
} from '@/lib/domain/concierge/access';

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
  if (!session) {
    // EVERY FLAG FALSE without a session, including the new one. A caller that
    // reads one field and ignores the shape must not get a true out of an
    // unauthenticated request.
    return NextResponse.json({ canGenerate: false, featureOn: false, hazardAvailable: false });
  }
  return NextResponse.json({
    canGenerate: canGenerateConcierge(session.role),
    featureOn: conciergeEnabled(),
    /**
     * Whether a MyNHD call would be refused before leaving this deploy.
     *
     * Not a permission and not a kill switch — a property of the environment.
     * MyNHD has issued a dev key only, so on a production deploy this is
     * false and the hazard control hides the actions that would reach the
     * vendor, instead of offering something that can only be declined.
     *
     * Behind the session with the rest, even though the health endpoint
     * publishes the same fact as a boolean: there is no reason for this one to
     * be the unauthenticated copy as well.
     */
    hazardAvailable: hazardPreviewAvailable(),
  });
}
