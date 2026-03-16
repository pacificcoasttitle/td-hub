import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { propertySearch, apnLookup } from '@/lib/integrations/sitex/client';

const addressSchema = z.object({
  mode: z.literal('address'),
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1).max(2).default('CA'),
  zip: z.string().min(3).max(10),
});

const apnSchema = z.object({
  mode: z.literal('apn'),
  apn: z.string().min(1),
  county: z.string().min(1),
  state: z.string().max(2).default('CA'),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.mode) {
    return NextResponse.json({ error: 'Missing mode parameter' }, { status: 400 });
  }

  if (body.mode === 'apn') {
    const parsed = apnSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
    }
    try {
      const result = await apnLookup(parsed.data);
      const data = result.success ? result.data : undefined;
      if (!data || data.matchCode !== 'S') {
        return NextResponse.json({ match: 'none', property: null, locations: [] });
      }
      return NextResponse.json({ match: 'single', property: data, locations: [] });
    } catch {
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  }

  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await propertySearch(parsed.data);
    if (!result.success) {
      return NextResponse.json({ match: 'none', property: null, locations: [] });
    }
    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
