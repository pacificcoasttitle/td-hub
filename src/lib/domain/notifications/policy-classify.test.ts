import { describe, expect, it } from 'vitest';
import { classifyPolicyFromVendor, POLICY_REQUIRED_ROLES } from './policy-classify';

describe('classifyPolicyFromVendor', () => {
  it('reads the vendor type, not the filename', () => {
    expect(classifyPolicyFromVendor({
      FileName: 'Owner Policy.pdf',
      DocType: 'Lender',
    })).toBe('lender_policy');
  });

  it('accepts Type and DocumentType', () => {
    expect(classifyPolicyFromVendor({ Type: 'Owner' })).toBe('owner_policy');
    expect(classifyPolicyFromVendor({ DocumentType: 'Supplement' })).toBe('supplement');
  });

  it('uses the requested DocType when the row has none', () => {
    expect(classifyPolicyFromVendor({ FileName: 'x.pdf' }, 'Lender')).toBe('lender_policy');
  });

  it('refuses to guess from a filename', () => {
    expect(classifyPolicyFromVendor({ FileName: 'Lender Policy Final.pdf' })).toBeNull();
  });
});

describe('required recipients', () => {
  it('is escrow+lender, owner, escrow', () => {
    expect(POLICY_REQUIRED_ROLES.lender_policy).toEqual(['escrow', 'lender']);
    expect(POLICY_REQUIRED_ROLES.owner_policy).toEqual(['owner']);
    expect(POLICY_REQUIRED_ROLES.supplement).toEqual(['escrow']);
  });
});
