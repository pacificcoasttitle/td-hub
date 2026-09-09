import { describe, expect, it } from 'vitest';
import { wizardPersonType } from './contact-list-page';

// ─── The six-character miss, and the silent default behind it ───────────────
//
// The old code tested `WIZARD_TYPES.has(typeFilter)` against a set containing
// `escrow`, while the escrow-officer pages pass `escrow_officer`. They missed,
// fell through to a form that returns 400, and Aileen could not add an external
// escrow officer at all.
//
// The mapper alongside it ended `return 'realtor'`, so fixing the set without
// fixing the mapper would have created escrow officers AS REALTORS — silently.

describe('wizardPersonType', () => {
  it('maps the types that pair with a company page', () => {
    expect(wizardPersonType('lender', 'external')).toBe('lender');
    expect(wizardPersonType('mortgage_broker', 'external')).toBe('mortgage_broker');
    expect(wizardPersonType('real_estate_agent', 'all')).toBe('realtor');
    expect(wizardPersonType('escrow', 'all')).toBe('escrow');
  });

  it('routes EXTERNAL escrow officers to the escrow person type', () => {
    // Aileen's page. People at outside escrow companies.
    expect(wizardPersonType('escrow_officer', 'external')).toBe('escrow');
  });

  it('refuses to create INTERNAL escrow officers', () => {
    // Same typeFilter, different scope. The internal roster is PCT branch units
    // — aayala@pct.com with the lookup code OCT — maintained in SoftPro.
    expect(wizardPersonType('escrow_officer', 'internal')).toBeNull();
  });

  it('refuses title officers and sales reps rather than inventing a type', () => {
    // There is no CreatePersonUserType for either.
    expect(wizardPersonType('title_officer', 'internal')).toBeNull();
    expect(wizardPersonType('sales_rep', 'all')).toBeNull();
  });

  it('THROWS on an unmapped type instead of defaulting to realtor', () => {
    // This is the whole point. A new page that forgets to add its case fails
    // loudly here rather than filing people as the wrong thing in SoftPro.
    expect(() => wizardPersonType('underwriter', 'external')).toThrow(/no SoftPro person type mapped/);
    expect(() => wizardPersonType('', 'all')).toThrow();
  });
});
