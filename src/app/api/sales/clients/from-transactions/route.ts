import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import {
  CrmAccessError, addClientsFromTransactions, listTransactionClients,
} from '@/lib/domain/crm/clients';

// Seeds a rep's client list from people they've actually closed deals with.
// GET is read-only over orders/order_parties/contacts; POST writes only to
// crm_clients, and only for contacts the server re-verifies as the caller's.

const querySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const bodySchema = z.object({
  contactIds: z.array(z.number().int().positive()).min(1).max(200),
});

function errorResponse(err: unknown) {
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

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await listTransactionClients(session, parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await addClientsFromTransactions(session, parsed.data.contactIds),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
