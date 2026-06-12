import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { isTessaPrelimEnabled } from '@/lib/tessa/analysis-config';

// Public-to-authenticated read of the EFFECTIVE AI Prelim feature flag.
// Any signed-in user can read it so the UI can hide/show the entry points.
// Effective = env master-kill allows AND admin DB flag (tessa_prelim_enabled) on.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enabled = await isTessaPrelimEnabled();
  return NextResponse.json({ enabled });
}
