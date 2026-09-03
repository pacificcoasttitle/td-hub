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
      // A VENDOR FAILURE IS NOT AN ABSENT PROPERTY.
      //
      // This used to read `result.success ? result.data : undefined` and then
      // fold everything into `match: 'none'`, so a 400 from SiteX and a genuine
      // no-match were indistinguishable by the time the UI saw them. The UI
      // faithfully rendered what it was told — "No property found for this
      // APN." — which is a claim about the world we had not earned. Every one
      // of the 32 APN lookups on record returned HTTP 400 "Missing required
      // fields", and every one of them told an operator the property does not
      // exist.
      // `VendorResult` is not a discriminated union — `success: boolean` with
      // `data?: T` — so `!result.success` does not narrow `data`. Both are
      // checked: a success carrying no data is an anomaly, not a no-match.
      if (!result.success || !result.data) {
        return NextResponse.json({ match: 'error', property: null, locations: [] });
      }
      if (result.data.matchCode !== 'S') {
        return NextResponse.json({ match: 'none', property: null, locations: [] });
      }
      return NextResponse.json({ match: 'single', property: result.data, locations: [] });
    } catch {
      return NextResponse.json({ match: 'error', property: null, locations: [] });
    }
  }

  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await propertySearch(parsed.data);
    // Same rule as the APN branch above: a failed call is an error, not an
    // answer about whether the property exists.
    if (!result.success) {
      return NextResponse.json({ match: 'error', property: null, locations: [] });
    }
    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json({ match: 'error', property: null, locations: [] });
  }
}
