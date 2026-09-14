import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canReadContactBook } from '@/lib/security/contact-book-access';
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
  if (!canReadContactBook(session.role)) {
    // The master book is internal. See contact-book-access.ts.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ matches: [] });
  }

  const matches = await findNearCompanies(parsed.data);
  return NextResponse.json({ matches });
}
