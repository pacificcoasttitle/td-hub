import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateFarming } from '@/lib/domain/reports/access';
import { canGenerateConcierge } from '@/lib/domain/concierge/access';
import { isFarmingType } from '@/lib/domain/reports/stored';
import { rerenderFarming } from '@/lib/domain/reports/generate';
import { retryProfile } from '@/lib/domain/concierge/retry';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST — "Try again" on a failed report. FREE, for every type.
 *
 * Farming: render again from the figures the row stores; refused if the
 * uploaded file was never kept. Concierge: finish from the stored payload, or
 * re-render if the comparables are already in; refused if there is no stored
 * payload, because that retry would buy the property again.
 *
 * Decided here, not in the browser: the row knows what it has, the list does
 * not. This route cannot reach the vendor — it imports neither the concierge
 * generator nor the SiteX client, and a test holds it to that.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { type, id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  if (isFarmingType(type)) {
    if (!canGenerateFarming(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const r = await rerenderFarming(type, id);
    if (r.ok) return NextResponse.json({ ok: true, reportId: id, pageCount: r.pageCount });
    const status = r.reason === 'not_found' ? 404 : r.reason === 'render' || r.reason === 'store' ? 502 : 409;
    return NextResponse.json({ error: r.message, reason: r.reason }, { status });
  }

  if (type === 'concierge_profile') {
    if (!canGenerateConcierge(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const r = await retryProfile(id);
    if (r.ok) return NextResponse.json({ ok: true, reportId: id, mode: r.mode, creditsCharged: 0 });
    const status = r.reason === 'not_found' ? 404 : r.reason === 'unreadable' || r.reason === 'render' ? 502 : 409;
    return NextResponse.json({ error: r.message, reason: r.reason, creditsCharged: 0 }, { status });
  }

  return NextResponse.json({ error: 'Unknown report type.' }, { status: 404 });
}
