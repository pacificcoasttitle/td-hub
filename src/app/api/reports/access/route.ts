import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateFarming } from '@/lib/domain/reports/access';

export const dynamic = 'force-dynamic';

/** What the New Report modal may OFFER. Every route re-checks. */
export async function GET() {
  const session = await getSession();
  return NextResponse.json({ farming: !!session && canGenerateFarming(session.role) });
}
