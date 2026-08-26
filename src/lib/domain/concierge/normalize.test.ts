import { describe, expect, it } from 'vitest';
import { normalizeSubject, toIsoDate } from './normalize';

/** Field shapes taken verbatim from the live production payload. */
const LIVE = {
  PropertyProfile: {
    SiteAddress: '10523 STONYBROOK AVE',
    SiteAddressCityState: '10523 STONYBROOK AVE, SOUTH GATE, CA 90280',
    SiteCity: 'SOUTH GATE', SiteState: 'CA', SiteZip: '90280',
    APN: '6233-014-010', CountyName: 'LOS ANGELES',
    PropertyCharacteristics: { Bedrooms: 3, Baths: 1, BuildingArea: 1487, YearBuilt: 1948, UseCodeDescription: 'Single Family Residential' },
    SaleLoanInfo: {},
  },
};

describe('subject address', () => {
  it('does not repeat the street line in the locality line', () => {
    const s = normalizeSubject(LIVE);
    expect(s.siteAddress).toBe('10523 STONYBROOK AVE');
    expect(s.siteCityState).toBe('SOUTH GATE, CA 90280');
    // The bug: SiteAddressCityState contains the street, so using it verbatim
    // printed "10523 STONYBROOK AVE" twice on the cover.
    expect(s.siteCityState).not.toContain('STONYBROOK');
  });

  it('falls back to the combined field when the parts are missing', () => {
    const s = normalizeSubject({ PropertyProfile: { SiteAddressCityState: 'ANYTOWN, CA 90001', SaleLoanInfo: {} } });
    expect(s.siteCityState).toBe('ANYTOWN, CA 90001');
  });
});

describe('subject last sale', () => {
  it('is null when SaleLoanInfo is empty — a real production case', () => {
    const s = normalizeSubject(LIVE);
    expect(s.lastSaleDate).toBeNull();
    expect(s.lastSalePrice).toBeNull();
  });
});

describe('date parsing', () => {
  it('handles the YYYYMMDD form SiteX uses for comps', () => {
    expect(toIsoDate('20260811')).toBe('2026-08-11');
  });

  it('handles the long form SiteX uses elsewhere', () => {
    expect(toIsoDate('6/1/2026 6:01:44 AM')).toBe('2026-06-01');
  });

  it('returns null for junk rather than a wrong date', () => {
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate('not a date')).toBeNull();
  });
});
