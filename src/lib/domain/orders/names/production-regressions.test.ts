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

  // PINNED BY VALUE, both owners. The previous version of this test asserted
  // `expect(r.secondary).not.toBeNull()`, which is why the second owner stayed
  // wrong through a green suite: it came out "Trinh Khanh" — surname dropped,
  // given names flipped — and a not-null check cannot see that.
  it('the Westminster borrower: one surname, stated once, belongs to both owners', () => {
    // SENT:  first "DANIEL", middle "QUI & KHANH TRINH", last "TIEU,"
    //        — an ampersand inside a middle name, and a comma inside a surname.
    const r = parseSiteXOwners('TIEU, DANIEL QUI & KHANH TRINH');
    expect(r.primary).toEqual({ firstName: 'Daniel', middleName: 'Qui', lastName: 'Tieu' });
    expect(r.secondary).toEqual({ firstName: 'Khanh', middleName: 'Trinh', lastName: 'Tieu' });
  });

  // Same shape, and worse: the flip promoted a middle initial to a first name
  // and sent a given name to SoftPro as the surname.
  it('a middle initial is never promoted to a first name', () => {
    const r = parseSiteXOwners('AJAYI, HOSEA J & VERONICA F');
    expect(r.primary).toEqual({ firstName: 'Hosea', middleName: 'J', lastName: 'Ajayi' });
    expect(r.secondary).toEqual({ firstName: 'Veronica', middleName: 'F', lastName: 'Ajayi' });
  });

  // A lone given name after the ampersand is a first name with an inherited
  // surname, not a surname with no first name.
  it('a single given name on the second owner inherits rather than becoming a surname', () => {
    const r = parseSiteXOwners('AGNE, WILFREDO & CZARINA');
    expect(r.primary).toEqual({ firstName: 'Wilfredo', middleName: '', lastName: 'Agne' });
    expect(r.secondary).toEqual({ firstName: 'Czarina', middleName: '', lastName: 'Agne' });
    expect(r.warnings.some((w) => w.includes('single word'))).toBe(false);
  });

  // The comma also fixes the PRIMARY whenever the surname is more than one
  // token. Positionally this used to read first "Veyra", last "De".
  it('a multi-word surname before the comma survives intact', () => {
    const r = parseSiteXOwners('DE VEYRA, TED T & JOSEPHINE F');
    expect(r.primary).toEqual({ firstName: 'Ted', middleName: 'T', lastName: 'De Veyra' });
    expect(r.secondary).toEqual({ firstName: 'Josephine', middleName: 'F', lastName: 'De Veyra' });
  });

  it('a multi-word surname on a single owner survives intact', () => {
    expect(parseSiteXOwners('VAN DER BERG, ANNA MARIE').primary)
      .toEqual({ firstName: 'Anna', middleName: 'Marie', lastName: 'Van Der Berg' });
  });

  // The shape the earlier test used: surname repeated on BOTH owners and no
  // comma anywhere. Positional, so it must stay exactly as it was.
  it('a surname repeated on both owners still parses positionally', () => {
    const r = parseSiteXOwners('TIEU DANIEL QUI & TIEU KHANH TRINH');
    expect(r.primary).toEqual({ firstName: 'Daniel', middleName: 'Qui', lastName: 'Tieu' });
    expect(r.secondary).toEqual({ firstName: 'Khanh', middleName: 'Trinh', lastName: 'Tieu' });
  });

  // Each owner may state its own surname. Not present in production today
  // (0 of 5,380 rows), but it falls out of the per-segment rule for free.
  it('each owner may state its own surname', () => {
    const r = parseSiteXOwners('TIEU, DANIEL & TRAN, KHANH');
    expect(r.primary).toEqual({ firstName: 'Daniel', middleName: '', lastName: 'Tieu' });
    expect(r.secondary).toEqual({ firstName: 'Khanh', middleName: '', lastName: 'Tran' });
  });

  // Only the second owner states one — the first stays positional.
  it('a comma on the second owner only does not change the first', () => {
    const r = parseSiteXOwners('TIEU DANIEL & TRAN, KHANH');
    expect(r.primary).toEqual({ firstName: 'Daniel', middleName: '', lastName: 'Tieu' });
    expect(r.secondary).toEqual({ firstName: 'Khanh', middleName: '', lastName: 'Tran' });
  });

  // This case USED to pin the broken behaviour deliberately — two people named
  // "B" and "A Group Inc" — with a comment saying it stayed that way until the
  // entity ticket was taken. It has been taken, so the expectation moves to the
  // fixed value rather than the test being deleted or relaxed.
  it('a truncated entity name is left whole, not split into two people', () => {
    const r = parseSiteXOwners('B & A GROUP INC,');
    expect(r.isEntity).toBe(true);
    expect(r.branch).toBe('entity-marker');
    expect(r.primary).toEqual({ firstName: '', middleName: '', lastName: 'B & A GROUP INC,' });
    expect(r.secondary).toBeNull();
    // The ampersand split no longer fires, so there is no second "owner".
    expect(r.warnings.some((w) => w.includes('organization'))).toBe(true);
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
