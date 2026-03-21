import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { preInitiateSearches } from '@/lib/domain/titlepoint/pre-initiate';

const bodySchema = z.object({
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  county: z.string().min(1),
  apn: z.string().nullable().default(null),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const result = await preInitiateSearches(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pre-initiation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
