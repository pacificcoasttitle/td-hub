import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { propertySearch, apnLookup } from '@/lib/integrations/sitex/client';

const addressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1).max(2).default('CA'),
  zip: z.string().min(5).max(10),
});

const apnSchema = z.object({
  apn: z.string().min(1),
  county: z.string().min(1),
  state: z.string().max(2).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    // APN-based lookup
    if (body.apn) {
      const parsed = apnSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid APN parameters', details: parsed.error.issues }, { status: 400 });
      }

      const result = await apnLookup(parsed.data);
      if (!result.success || !result.data || result.data.matchCode !== 'S') {
        return NextResponse.json({ match: 'none' });
      }

      const p = result.data;
      return NextResponse.json({
        match: 'single',
        property: {
          apn: p.apn,
          legalDescription: p.legalDescription,
          county: p.county,
          primaryOwner: p.primaryOwner,
          secondaryOwner: p.secondaryOwner,
          propertyType: p.propertyType,
          fullAddress: p.fullAddress,
          city: p.city,
          state: p.state,
          zip: p.zip,
          unitNumber: p.unitNumber,
          beds: p.beds,
          baths: p.baths,
          sqft: p.sqft,
          lotSize: p.lotSize,
          yearBuilt: p.yearBuilt,
        },
      });
    }

    // Address-based search
    const parsed = addressSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid address parameters', details: parsed.error.issues }, { status: 400 });
    }

    const result = await propertySearch(parsed.data);
    if (!result.success || !result.data) {
      return NextResponse.json({ match: 'none' });
    }

    const data = result.data;

    if (data.match === 'single' && data.property) {
      const p = data.property;
      return NextResponse.json({
        match: 'single',
        property: {
          apn: p.apn,
          legalDescription: p.legalDescription,
          county: p.county,
          primaryOwner: p.primaryOwner,
          secondaryOwner: p.secondaryOwner,
          propertyType: p.propertyType,
          fullAddress: p.fullAddress,
          city: p.city,
          state: p.state,
          zip: p.zip,
          unitNumber: p.unitNumber,
          beds: p.beds,
          baths: p.baths,
          sqft: p.sqft,
          lotSize: p.lotSize,
          yearBuilt: p.yearBuilt,
        },
      });
    }

    if (data.match === 'multi') {
      return NextResponse.json({
        match: 'multi',
        locations: data.locations,
      });
    }

    return NextResponse.json({ match: 'none' });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
