import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { findNearCompanies } from '@/lib/domain/contacts/create-company';

const querySchema = z.object({
  name: z.string().min(2).max(200),
  address1: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ matches: [] });
  }

  const matches = await findNearCompanies(parsed.data);
  return NextResponse.json({ matches });
}
