import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { propertyLookup } from '@/lib/integrations/sitex/client';

const bodySchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1).max(2),
  zip: z.string().min(5).max(10),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid parameters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await propertyLookup(parsed.data);

  if (!result.success || result.data.matchCode !== 'S') {
    return NextResponse.json({ success: false, error: 'No property match found' });
  }

  const { apn, county, legalDescription, primaryOwner, secondaryOwner, propertyType } = result.data;

  return NextResponse.json({
    success: true,
    data: { apn, county, legalDescription, primaryOwner, secondaryOwner, propertyType },
  });
}
