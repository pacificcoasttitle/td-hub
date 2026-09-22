import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateFarming } from '@/lib/domain/reports/access';
import { isFarmingType } from '@/lib/domain/reports/stored';
import { notifyRep } from '@/lib/domain/reports/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST — tell the branded rep their report is ready, PDF attached.
 *
 * The recipient is the rep on the report row, read server-side. Nothing in the
 * request names who receives it — there is no body at all — so this route
 * cannot be pointed at an outside address. That act, sending to an agent, is a
 * different one and is not built.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateFarming(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { type, id: rawId } = await params;
  if (!isFarmingType(type)) return NextResponse.json({ error: 'Only a farming report can be sent to its rep.' }, { status: 404 });
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const r = await notifyRep({ type, id, sentBy: session.email });
  if (r.ok) return NextResponse.json({ outcome: 'sent', deliveryId: r.deliveryId, recipientName: r.recipientName, recipientEmail: r.recipientEmail });
  if (r.deliveryId === null) {
    return NextResponse.json({ error: r.message, reason: r.reason }, { status: r.reason === 'not_found' ? 404 : 409 });
  }
  return NextResponse.json({ error: r.message, reason: r.reason, outcome: 'failed', deliveryId: r.deliveryId }, { status: 502 });
}
