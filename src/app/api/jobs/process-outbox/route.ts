import { NextRequest, NextResponse } from 'next/server';
import { processOutboxEvents } from '@/lib/domain/notifications/service';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.JOB_RUNNER_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  return authHeader === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await processOutboxEvents();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Outbox processing failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
