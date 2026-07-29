import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { CrmAccessError, importClients } from '@/lib/domain/crm/clients';

// Rows are parsed from the CSV client-side (PR2 UI) and posted as JSON —
// one request, one transaction, no file handling on the server (spec §7.12).
const importSchema = z.object({
  rows: z.array(z.object({
    name: z.string().max(200).optional().nullable(),
    company: z.string().max(200).optional().nullable(),
    email: z.string().max(200).optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
  })).max(1000, 'That file has more than 1,000 rows — please split it into smaller files'),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    const tooBig = parsed.error.issues.find((i) => i.code === 'too_big');
    if (tooBig) {
      return NextResponse.json({ error: tooBig.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await importClients(session, parsed.data.rows);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CrmAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: 'Internal server error', ...(process.env.NODE_ENV === 'development' && { detail: err instanceof Error ? err.message : 'Unknown' }) },
      { status: 500 },
    );
  }
}
