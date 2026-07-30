import { describe, expect, it } from 'vitest';
import {
  CRM_CLIENT_TYPES, deriveClientType, isCrmClientType, partyRoleToClientType,
} from './types';

describe('partyRoleToClientType', () => {
  it('maps agent roles', () => {
    expect(partyRoleToClientType('listing_agent')).toBe('agent');
    expect(partyRoleToClientType('buyer_agent')).toBe('agent');
  });

  it('maps lender roles', () => {
    expect(partyRoleToClientType('lender')).toBe('lender');
    expect(partyRoleToClientType('lender_contact')).toBe('lender');
  });

  it('maps escrow and title roles', () => {
    expect(partyRoleToClientType('escrow_company')).toBe('escrow');
    expect(partyRoleToClientType('title_company')).toBe('title');
    expect(partyRoleToClientType('title_officer')).toBe('title');
  });

  it('classifies unrecognised business-source roles as other', () => {
    expect(partyRoleToClientType('other')).toBe('other');
    expect(partyRoleToClientType('some_future_role')).toBe('other');
  });

  it('refuses to classify consumer roles and the bare client relationship', () => {
    for (const role of ['buyer', 'seller', 'borrower', 'client']) {
      expect(partyRoleToClientType(role)).toBeNull();
    }
  });
});

describe('deriveClientType', () => {
  it('returns null when nothing classifies', () => {
    expect(deriveClientType([])).toBeNull();
    expect(deriveClientType(['client'])).toBeNull();
    expect(deriveClientType(['buyer', 'seller'])).toBeNull();
  });

  it('lets a specific role win over the bare client relationship', () => {
    expect(deriveClientType(['client', 'listing_agent'])).toBe('agent');
  });

  it('prefers a specific classification over other', () => {
    expect(deriveClientType(['other', 'lender'])).toBe('lender');
    expect(deriveClientType(['some_future_role', 'escrow_company'])).toBe('escrow');
  });

  it('is order-independent', () => {
    expect(deriveClientType(['lender', 'listing_agent']))
      .toBe(deriveClientType(['listing_agent', 'lender']));
  });

  it('falls back to other when only unrecognised roles are present', () => {
    expect(deriveClientType(['mystery_role'])).toBe('other');
  });
});

describe('isCrmClientType', () => {
  it('accepts exactly the five values', () => {
    for (const t of CRM_CLIENT_TYPES) expect(isCrmClientType(t)).toBe(true);
    expect(CRM_CLIENT_TYPES).toHaveLength(5);
  });

  it('rejects anything else', () => {
    for (const v of ['Agent', 'buyer', '', null, undefined, 7, {}]) {
      expect(isCrmClientType(v)).toBe(false);
    }
  });
});
