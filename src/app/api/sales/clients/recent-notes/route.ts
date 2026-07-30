import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { CrmAccessError, listRecentNotes } from '@/lib/domain/crm/clients';

// Recent notes across the caller's clients (or a managed rep's, via repId).
// READ-ONLY.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const rawLimit = Number(sp.get('limit') ?? '10');
  const limit = Number.isFinite(rawLimit) ? rawLimit : 10;

  try {
    const notes = await listRecentNotes(session, { repId: sp.get('repId'), limit });
    return NextResponse.json({ notes });
  } catch (err) {
    if (err instanceof CrmAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && {
          detail: err instanceof Error ? err.message : 'Unknown',
        }),
      },
      { status: 500 },
    );
  }
}
