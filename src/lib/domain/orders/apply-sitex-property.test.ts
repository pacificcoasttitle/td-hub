import { beforeEach, describe, expect, it, vi } from 'vitest';

const propertyUpdateSets: Array<Record<string, unknown>> = [];
const propertyInserts: Array<Record<string, unknown>> = [];
let existingProperty: Record<string, unknown> | null = null;

vi.mock('drizzle-orm', () => ({
  eq: (field: unknown, value: unknown) => ({ op: 'eq', field, value }),
}));

vi.mock('@/lib/db/schema', () => ({
  orderProperties: {
    __table: 'order_properties',
    id: 'order_properties.id',
    orderId: 'order_properties.order_id',
    zip: 'order_properties.zip',
    county: 'order_properties.county',
    apn: 'order_properties.apn',
    legalDescription: 'order_properties.legal_description',
    propertyType: 'order_properties.property_type',
    primaryOwner: 'order_properties.primary_owner',
    secondaryOwner: 'order_properties.secondary_owner',
    fullAddress: 'order_properties.full_address',
    city: 'order_properties.city',
    state: 'order_properties.state',
  },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (existingProperty ? [existingProperty] : [])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        propertyUpdateSets.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        propertyInserts.push(values);
      }),
    })),
  },
}));

import { applySiteXPropertyFields } from './apply-sitex-property';
import type { SiteXPropertyData } from '@/lib/integrations/sitex/types';

function siteX(overrides: Partial<SiteXPropertyData> = {}): SiteXPropertyData {
  return {
    matchCode: 'S',
    apn: '8321-027-034',
    legalDescription: 'LOT 34 TRACT 1',
    county: 'Los Angeles',
    fips: '06037',
    propertyType: 'Single Family Residence',
    primaryOwner: 'Owner A',
    secondaryOwner: null,
    fullAddress: '123 Main St',
    city: 'Glendale',
    state: 'CA',
    zip: '91203',
    unitNumber: null,
    beds: null,
    baths: null,
    sqft: null,
    lotSize: null,
    yearBuilt: null,
    assessedValue: null,
    lastSaleDate: null,
    lastSalePrice: null,
    ...overrides,
  };
}

describe('applySiteXPropertyFields', () => {
  beforeEach(() => {
    propertyUpdateSets.length = 0;
    propertyInserts.length = 0;
    existingProperty = {
      id: 7,
      zip: null,
      county: null,
      apn: null,
      legalDescription: null,
      propertyType: null,
      primaryOwner: null,
      secondaryOwner: null,
      fullAddress: null,
      city: null,
      state: null,
    };
  });

  it('fills blank apn/legal/propertyType/zip from SiteX single match', async () => {
    const result = await applySiteXPropertyFields(42, siteX());

    expect(result.applied).toBe(true);
    expect(result.fieldsFilled).toEqual(
      expect.arrayContaining(['apn', 'legalDescription', 'propertyType', 'zip']),
    );
    expect(propertyUpdateSets).toHaveLength(1);
    expect(propertyUpdateSets[0]).toMatchObject({
      apn: '8321-027-034',
      legalDescription: 'LOT 34 TRACT 1',
      propertyType: 'Single Family Residence',
      zip: '91203',
    });
  });

  it('never overwrites existing non-empty fields (preserve-on-empty)', async () => {
    existingProperty = {
      id: 7,
      zip: '90001',
      county: 'Orange',
      apn: 'EXISTING-APN',
      legalDescription: 'EXISTING LEGAL',
      propertyType: 'Condo',
      primaryOwner: 'Keep Me',
      secondaryOwner: null,
      fullAddress: null,
      city: null,
      state: null,
    };

    const result = await applySiteXPropertyFields(42, siteX({
      apn: 'NEW-APN',
      legalDescription: 'NEW LEGAL',
      propertyType: 'Single Family Residence',
      zip: '91203',
      primaryOwner: 'Overwrite?',
    }));

    expect(result.fieldsFilled).not.toContain('apn');
    expect(result.fieldsFilled).not.toContain('legalDescription');
    expect(result.fieldsFilled).not.toContain('propertyType');
    expect(result.fieldsFilled).not.toContain('zip');
    expect(result.fieldsFilled).not.toContain('primaryOwner');
    expect(propertyUpdateSets[0]).not.toHaveProperty('apn');
    expect(propertyUpdateSets[0]).not.toHaveProperty('zip');
  });

  it('does not blank fields when SiteX returns empty strings', async () => {
    existingProperty = {
      id: 7,
      zip: '90001',
      county: 'Orange',
      apn: 'KEEP',
      legalDescription: 'KEEP LEGAL',
      propertyType: 'Condo',
      primaryOwner: null,
      secondaryOwner: null,
      fullAddress: null,
      city: null,
      state: null,
    };

    const result = await applySiteXPropertyFields(42, siteX({
      apn: '',
      legalDescription: '   ',
      propertyType: null,
      zip: '',
      primaryOwner: 'New Owner',
    }));

    expect(result.applied).toBe(true);
    expect(result.fieldsFilled).toContain('primaryOwner');
    expect(result.fieldsFilled).not.toContain('apn');
    expect(result.fieldsFilled).not.toContain('legalDescription');
    expect(result.fieldsFilled).not.toContain('propertyType');
    expect(result.fieldsFilled).not.toContain('zip');
    expect(propertyUpdateSets[0]).toMatchObject({ primaryOwner: 'New Owner' });
    expect(propertyUpdateSets[0]).not.toHaveProperty('apn');
    expect(propertyUpdateSets[0]).not.toHaveProperty('zip');
  });

  it('ignores non-single matches', async () => {
    const result = await applySiteXPropertyFields(42, siteX({ matchCode: 'M' }));
    expect(result).toEqual({ applied: false, fieldsFilled: [] });
    expect(propertyUpdateSets).toHaveLength(0);
  });
});
