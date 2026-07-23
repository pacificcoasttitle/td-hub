import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getPreInitSessionStatus } from '@/lib/domain/titlepoint/pre-init-status';

/**
 * UI poll endpoint — Tax+LV terminal readiness for the open-order submit gate.
 * GET /api/titlepoint/pre-initiate/status?sessionId=tp_api_id_…
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionId = req.nextUrl.searchParams.get('sessionId')?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const status = await getPreInitSessionStatus(sessionId);
  if (!status) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json(status);
}
