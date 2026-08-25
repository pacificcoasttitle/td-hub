import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSiteXOwners } from './sitex-owner-names';
import { createOrderInputSchema } from '../create-order';

// ─── The exact strings that went to SoftPro wrong ───────────────────────────
//
// Both are taken verbatim from vendor_api_logs, from creates made on
// 2026-08-24. They are the reason this module exists, so they are pinned.

describe('the two names production actually got wrong', () => {
  it('the Visalia borrower: surname was transmitted as "T"', () => {
    // SENT:  PrimaryBorrowerFirstName "SERGIO"
    //        PrimaryBorrowerMiddleName "SANCHEZ"
    //        PrimaryBorrowerLastName  "T"      <-- a one-letter surname
    const { primary } = parseSiteXOwners('SANCHEZ SERGIO T');
    expect(primary).toEqual({ firstName: 'Sergio', middleName: 'T', lastName: 'Sanchez' });
    expect(primary!.lastName).not.toBe('T');
  });

  it('the Westminster borrower: two owners were transmitted as one', () => {
    // SENT:  first "DANIEL", middle "QUI & KHANH TRINH", last "TIEU,"
    //        — an ampersand inside a middle name, and a comma inside a surname.
    const r = parseSiteXOwners('TIEU, DANIEL QUI & KHANH TRINH');
    expect(r.primary!.lastName).toBe('Tieu');
    expect(r.primary!.firstName).toBe('Daniel');
    expect(r.primary!.middleName).not.toContain('&');
    expect(r.primary!.lastName).not.toContain(',');
    expect(r.secondary).not.toBeNull();
  });

  it('the Redlands borrower was already correct and stays correct', () => {
    // SENT: "CHRISTOPHER" / "KENNETH JR" / "HAMILTON" — this one was right.
    const { primary } = parseSiteXOwners('HAMILTON CHRISTOPHER KENNETH JR');
    expect(primary).toEqual({ firstName: 'Christopher', middleName: 'Kenneth Jr', lastName: 'Hamilton' });
  });
});

describe('parsed owners satisfy the create-order contract', () => {
  it('a parsed owner passes schema validation as a buyer', () => {
    const { primary } = parseSiteXOwners('SANCHEZ SERGIO T');
    const parsed = createOrderInputSchema.parse({
      orderType: 'Title only',
      property: { address: '1434 N Elm St', city: 'Visalia', state: 'CA', zip: '93291' },
      buyer: {
        firstName: primary!.firstName || 'TBD',
        middleName: primary!.middleName || undefined,
        lastName: primary!.lastName || 'TBD',
      },
      transaction: { type: 'Refinance', product: 'Short Form' },
    });
    expect(parsed.buyer.lastName).toBe('Sanchez');
    expect(parsed.buyer.firstName).toBe('Sergio');
  });

  it('a single-token owner does not fabricate a first name in the payload', () => {
    const { primary } = parseSiteXOwners('SMITH');
    // firstName is empty, so the existing `|| 'TBD'` fallback shows TBD rather
    // than inventing a person called Smith Smith.
    expect(primary!.firstName).toBe('');
    expect(primary!.lastName).toBe('Smith');
  });
});

describe('the old parser is gone', () => {
  it('use-quick-entry no longer contains parseOwnerName', () => {
    const src = readFileSync(
      join(__dirname, '../../../../components/admin/quick-entry/use-quick-entry.ts'),
      'utf8',
    );
    expect(src).not.toContain('parseOwnerName');
    expect(src).toContain('parseSiteXOwners');
  });

  it('the form surfaces owner warnings rather than swallowing them', () => {
    const hook = readFileSync(
      join(__dirname, '../../../../components/admin/quick-entry/use-quick-entry.ts'), 'utf8');
    const view = readFileSync(
      join(__dirname, '../../../../components/admin/quick-entry/sections.tsx'), 'utf8');
    expect(hook).toContain('setOwnerWarnings');
    expect(view).toContain('ownerWarnings');
  });
});
