import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifySiteXOwners } from './classify-owners';
import { parseSiteXOwners } from './sitex-owner-names';

function fml(p: { firstName: string; middleName: string; lastName: string } | null): string {
  if (!p) return '';
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' / ');
}

describe('classifySiteXOwners — entity stays an org', () => {
  it('B REAL ESTATE INVESTMENT LLC is an org, not Real / Estate Investment Llc / B', () => {
    const flipped = parseSiteXOwners('B REAL ESTATE INVESTMENT LLC').primary;
    expect(fml(flipped)).toBe('Real / Estate Investment Llc / B');

    const owners = classifySiteXOwners(
      'B REAL ESTATE INVESTMENT LLC',
      'B REAL ESTATE INVESTMENT LLC',
    );
    expect(owners.primary?.isOrg).toBe(true);
    expect(owners.primary?.kind).toBe('company');
    expect(owners.primary?.orgType).toBe('LLC');
    expect(owners.primary?.person).toEqual({
      firstName: 'B REAL ESTATE INVESTMENT LLC',
      middleName: '',
      lastName: '',
    });
    expect(fml(owners.primary!.person)).not.toBe('Real / Estate Investment Llc / B');

    expect(owners.secondary?.isOrg).toBe(true);
    expect(owners.secondary?.person.firstName).toBe('B REAL ESTATE INVESTMENT LLC');
    expect(owners.secondary?.person.middleName).toBe('');
    expect(owners.secondary?.person.lastName).toBe('');
  });

  it('a CPL trust fixture stays a trust and is not split', () => {
    const owners = classifySiteXOwners('WERNER AND DONNA STEFFEN FAMILY TRUST');
    expect(owners.primary?.kind).toBe('trust');
    expect(owners.primary?.isOrg).toBe(true);
    expect(owners.primary?.orgType).toBe('Trust');
    expect(owners.primary?.person.firstName).toBe('WERNER AND DONNA STEFFEN FAMILY TRUST');
    expect(owners.primary?.person.lastName).toBe('');
  });
});

describe('classifySiteXOwners — a person still flips', () => {
  it('SANCHEZ SERGIO T becomes Sergio / T / Sanchez', () => {
    const owners = classifySiteXOwners('SANCHEZ SERGIO T');
    expect(owners.primary?.isOrg).toBe(false);
    expect(owners.primary?.kind).toBe('person');
    expect(fml(owners.primary!.person)).toBe('Sergio / T / Sanchez');
  });
});

describe('both open-order forms use the classifier', () => {
  it('hub fillOwners and client fillOwnersFromSiteX import classifySiteXOwners', () => {
    const hub = readFileSync(
      join(__dirname, '../../../../components/admin/quick-entry/use-quick-entry.ts'),
      'utf8',
    );
    const client = readFileSync(
      join(__dirname, '../../../../app/client/orders/new/page.tsx'),
      'utf8',
    );
    expect(hub).toContain('classifySiteXOwners');
    expect(client).toContain('classifySiteXOwners');
    expect(hub).not.toContain('parseSiteXOwners');
    expect(client).not.toMatch(/primaryOwner\.split\(' '\)/);
  });
});
