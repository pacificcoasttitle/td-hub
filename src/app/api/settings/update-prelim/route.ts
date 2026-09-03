import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { isUpdatePrelimEnabled } from '@/lib/domain/prelim/update-prelim-flag';

// Authenticated read of the effective Update Prelim flag so the sales row can
// decide whether to render the button. Effective = env backstop allows AND the
// admin DB flag is on. The POST endpoint re-checks; this is display only.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enabled = await isUpdatePrelimEnabled();
  return NextResponse.json({ enabled });
}
