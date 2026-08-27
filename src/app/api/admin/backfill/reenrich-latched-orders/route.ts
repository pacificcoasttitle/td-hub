import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { handleReenrichLatchedOrders } from '@/lib/jobs/handlers/enrich-orders';

// ─── Re-enrich the orders the one-way contacts latch stranded ────────────────
//
// `contacts_empty_confirmed` used to be terminal, so 96 orders with zero party
// rows were excluded from every scheduled run and could only be reached by hand,
// one file number at a time. The picker now expires the latch, which fixes the
// forward case; this route clears the backlog those orders accumulated while it
// did not.
//
// DRY RUN IS THE DEFAULT. `?apply=true` is required to write, so the URL that
// previews and the URL that acts are not one keystroke apart. The preview
// resolves every party row the writer would resolve — including the
// `external_email` that decides whether a new recipient appears — and writes
// nothing.
//
// It drives `enrichSingleOrder`, so this is the same mapper, the same identity
// resolution and the same upsert as every other enrichment. Nothing here is a
// second way to write a party row.

export const maxDuration = 300;

const ALLOWED_ROLES = ['super_admin', 'admin'];

function parseLimit(value: string | null): number | undefined {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return undefined;
  return Math.min(requested, 250);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apply = req.nextUrl.searchParams.get('apply') === 'true';

  try {
    const result = await handleReenrichLatchedOrders({
      dryRun: !apply,
      limit: parseLimit(req.nextUrl.searchParams.get('limit')),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[reenrich-latched-orders] failed:', err);
    return NextResponse.json(
      { error: 'Re-enrichment failed', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
