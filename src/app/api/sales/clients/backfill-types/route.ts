import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { CrmAccessError, backfillClientTypes } from '@/lib/domain/crm/clients';

// One-off, idempotent classification backfill for the caller's OWN clients:
// fills `type` only where it is empty and a contact is linked. Safe to re-run.
// READ-ONLY over orders/order_parties; the only write is crm_clients.type.

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await backfillClientTypes(session));
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
