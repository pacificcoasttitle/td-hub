import { db } from '@/lib/db/client';
import { orderProperties } from '@/lib/db/schema';
import type { SiteXPropertyData } from '@/lib/integrations/sitex/types';
import { eq } from 'drizzle-orm';

function isBlank(value: string | null | undefined): boolean {
  return !value || !value.trim();
}

/**
 * Fill order_properties from a SiteX single-match (`matchCode === 'S'`).
 * Idempotent preserve-on-empty:
 * - never write blank SiteX values
 * - never overwrite a field that already has a non-empty value
 *
 * Property Type here is SiteX UseCodeDescription (parcel use), not SoftPro ProductType.
 */
export async function applySiteXPropertyFields(
  orderId: number,
  data: SiteXPropertyData,
): Promise<{ applied: boolean; fieldsFilled: string[] }> {
  if (data.matchCode !== 'S') {
    return { applied: false, fieldsFilled: [] };
  }

  const [existing] = await db
    .select({
      id: orderProperties.id,
      zip: orderProperties.zip,
      county: orderProperties.county,
      apn: orderProperties.apn,
      legalDescription: orderProperties.legalDescription,
      propertyType: orderProperties.propertyType,
      primaryOwner: orderProperties.primaryOwner,
      secondaryOwner: orderProperties.secondaryOwner,
      fullAddress: orderProperties.fullAddress,
      city: orderProperties.city,
      state: orderProperties.state,
    })
    .from(orderProperties)
    .where(eq(orderProperties.orderId, orderId))
    .limit(1);

  const patch: Partial<typeof orderProperties.$inferInsert> = {};
  const fieldsFilled: string[] = [];

  const fill = (
    key: keyof typeof patch,
    incoming: string | null | undefined,
    current: string | null | undefined,
  ) => {
    if (isBlank(incoming) || !isBlank(current)) return;
    (patch as Record<string, string>)[key as string] = incoming!.trim();
    fieldsFilled.push(key as string);
  };

  if (existing) {
    fill('zip', data.zip, existing.zip);
    fill('county', data.county, existing.county);
    fill('apn', data.apn, existing.apn);
    fill('legalDescription', data.legalDescription, existing.legalDescription);
    fill('propertyType', data.propertyType, existing.propertyType);
    fill('primaryOwner', data.primaryOwner, existing.primaryOwner);
    fill('secondaryOwner', data.secondaryOwner, existing.secondaryOwner);
    fill('fullAddress', data.fullAddress, existing.fullAddress);
    fill('city', data.city, existing.city);
    fill('state', data.state, existing.state);

    if (fieldsFilled.length === 0) {
      return { applied: false, fieldsFilled: [] };
    }

    await db.update(orderProperties).set({
      ...patch,
      updatedAt: new Date(),
    }).where(eq(orderProperties.id, existing.id));

    return { applied: true, fieldsFilled };
  }

  // No property row yet — insert only non-empty SiteX values.
  const values: typeof orderProperties.$inferInsert = { orderId };
  fill('zip', data.zip, null);
  fill('county', data.county, null);
  fill('apn', data.apn, null);
  fill('legalDescription', data.legalDescription, null);
  fill('propertyType', data.propertyType, null);
  fill('primaryOwner', data.primaryOwner, null);
  fill('secondaryOwner', data.secondaryOwner, null);
  fill('fullAddress', data.fullAddress, null);
  fill('city', data.city, null);
  fill('state', data.state, null);
  Object.assign(values, patch);

  if (fieldsFilled.length === 0) {
    return { applied: false, fieldsFilled: [] };
  }

  await db.insert(orderProperties).values(values);
  return { applied: true, fieldsFilled };
}
