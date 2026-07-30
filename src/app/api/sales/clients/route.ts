import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { CrmAccessError, createClient, listClients } from '@/lib/domain/crm/clients';
import { CRM_CLIENT_TYPES, isCrmClientType } from '@/lib/domain/crm/types';

function errorResponse(err: unknown) {
  if (err instanceof CrmAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json(
    { error: 'Internal server error', ...(process.env.NODE_ENV === 'development' && { detail: err instanceof Error ? err.message : 'Unknown' }) },
    { status: 500 },
  );
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const rawType = sp.get('type');
  if (rawType && !isCrmClientType(rawType)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }
  try {
    const result = await listClients(session, {
      search: sp.get('search')?.trim() || undefined,
      page: Math.max(1, Number(sp.get('page') ?? '1')),
      pageSize: Math.min(Math.max(1, Number(sp.get('pageSize') ?? '25')), 100),
      repId: sp.get('repId'),
      type: rawType && isCrmClientType(rawType) ? rawType : undefined,
      quietOnly: sp.get('quiet') === '1',
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().max(200).optional().nullable(),
  email: z.string().email().max(200).optional().nullable().or(z.literal('')),
  phone: z.string().max(50).optional().nullable(),
  type: z.enum(CRM_CLIENT_TYPES).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await createClient(session, {
      ...parsed.data,
      email: parsed.data.email || null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
