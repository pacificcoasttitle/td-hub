import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { propertyLookup } from '@/lib/integrations/sitex/client';

const bodySchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1).max(2).default('CA'),
  zip: z.string().min(5).max(10),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid parameters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await propertyLookup(parsed.data);

    const data = result.success ? result.data : undefined;
    if (!data || data.matchCode !== 'S') {
      return NextResponse.json({ success: false, error: 'No property match found' });
    }

    return NextResponse.json({
      success: true,
      data: {
        apn: data.apn,
        county: data.county,
        legalDescription: data.legalDescription,
        primaryOwner: data.primaryOwner,
        secondaryOwner: data.secondaryOwner,
        propertyType: data.propertyType,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
