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
    // The classification is still correct and still used — only the FLAG is off.
    expect(owners.primary?.kind).toBe('company');
    expect(owners.primary?.orgType).toBe('LLC');
    expect(owners.primary?.isOrg).toBe(false); // see the flag suite below
    expect(owners.primary?.person).toEqual({
      firstName: 'B REAL ESTATE INVESTMENT LLC',
      middleName: '',
      lastName: '-',
    });
    expect(fml(owners.primary!.person)).not.toBe('Real / Estate Investment Llc / B');

    expect(owners.secondary?.person.firstName).toBe('B REAL ESTATE INVESTMENT LLC');
    expect(owners.secondary?.person.middleName).toBe('');
  });

  it('a CPL trust fixture stays a trust and is not split', () => {
    const owners = classifySiteXOwners('WERNER AND DONNA STEFFEN FAMILY TRUST');
    expect(owners.primary?.kind).toBe('trust');
    expect(owners.primary?.orgType).toBe('Trust');
    expect(owners.primary?.person.firstName).toBe('WERNER AND DONNA STEFFEN FAMILY TRUST');
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

// ─── The organization flag is deliberately off ──────────────────────────────
//
// NOT a preference. `IsOrganization: true` makes SoftPro drop the party's name.
// Four staging creates, same entity name, one variable each:
//
//   legacy split shape, "true"   -> PrimarySeller ""
//   our shape,          "true"   -> PrimarySeller ""
//   our shape,  boolean true     -> PrimarySeller ""
//   CONTROL,            "false"  -> PrimarySeller "PACIFIC HOLDINGS LLC -"
//
// And in production, same call and in two cases the same order:
//
//   20021656-GLT  seller[ORG] "Properties Llc Ahava"     READ ""
//   20021757-GLT  seller NOT org "Walter E Dancsecs"     READ "Walter E Dancsecs"
//
// These assertions exist so the flag cannot be switched back on without a
// deliberate edit and a reader who is told why.

describe('the SoftPro organization flag stays off until the vendor explains it', () => {
  const ENTITIES = [
    'B REAL ESTATE INVESTMENT LLC',
    'WERNER AND DONNA STEFFEN FAMILY TRUST',
    'PACIFIC HOLDINGS LLC',
    'V M G INVESTMENT LLC',
  ];

  it('no entity is ever flagged as an organization', () => {
    for (const name of ENTITIES) {
      const o = classifySiteXOwners(name);
      expect(o.primary?.isOrg, name).toBe(false);
    }
  });

  it('but the entity is still RECOGNISED — the classification is not lost', () => {
    for (const name of ENTITIES) {
      const o = classifySiteXOwners(name);
      expect(['company', 'trust'], name).toContain(o.primary?.kind);
      expect(o.primary?.orgType, name).not.toBe('');
    }
  });

  it('and the name is still unsplit, which is the part that actually helps', () => {
    // The person parser turned this into "Huisje / Nevada Llc / Leuk" in
    // production. Keeping it whole is the real improvement; the flag never was.
    const o = classifySiteXOwners('LEUK HUISJE NEVADA LLC');
    expect(o.primary?.person.firstName).toBe('LEUK HUISJE NEVADA LLC');
    expect(o.primary?.person.middleName).toBe('');
  });

  it('last name is "-", not empty, so SoftPro does not store "… TBD"', () => {
    // The payload builder substitutes TBD for an empty last name on a
    // non-organization party, and SoftPro concatenates the parts.
    const o = classifySiteXOwners('PACIFIC HOLDINGS LLC');
    expect(o.primary?.person.lastName).toBe('-');
  });
});
