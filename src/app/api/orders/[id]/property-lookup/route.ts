import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { db } from '@/lib/db/client';
import { orderProperties } from '@/lib/db/schema';
import { propertyLookup } from '@/lib/integrations/sitex/client';
import { eq } from 'drizzle-orm';

const paramSchema = z.object({ id: z.coerce.number().int().positive() });

const bodySchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1).max(2),
  zip: z.string().min(5).max(10),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const resolved = await params;
  const parsedParams = paramSchema.safeParse(resolved);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }
  const orderId = parsedParams.data.id;

  if (!(await canAccessOrder(session, orderId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  let lookupResult: Awaited<ReturnType<typeof propertyLookup>>;
  try {
    lookupResult = await propertyLookup(parsed.data);
  } catch {
    return NextResponse.json({ error: 'Property lookup failed' }, { status: 500 });
  }

  const property = lookupResult.success ? lookupResult.data : undefined;
  if (!property || property.matchCode !== 'S') {
    return NextResponse.json({ success: false, error: 'No property match found' }, { status: 422 });
  }

  const fullAddress = property.fullAddress
    ?? [parsed.data.street, parsed.data.city, parsed.data.state, parsed.data.zip].filter(Boolean).join(', ');

  const values = {
    address: parsed.data.street,
    city: property.city ?? parsed.data.city,
    state: property.state ?? parsed.data.state,
    zip: property.zip ?? parsed.data.zip,
    county: property.county,
    fullAddress,
    apn: property.apn,
    legalDescription: property.legalDescription,
    propertyType: property.propertyType,
    primaryOwner: property.primaryOwner,
    secondaryOwner: property.secondaryOwner,
    updatedAt: new Date(),
  };

  const [existing] = await db
    .select({ id: orderProperties.id })
    .from(orderProperties)
    .where(eq(orderProperties.orderId, orderId))
    .limit(1);

  if (existing) {
    await db
      .update(orderProperties)
      .set(values)
      .where(eq(orderProperties.id, existing.id));
  } else {
    await db.insert(orderProperties).values({
      orderId,
      ...values,
    });
  }

  return NextResponse.json({
    success: true,
    property: values,
  });
}
