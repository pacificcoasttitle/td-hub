import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOrderInputSchema } from './create-order';
import { buildSoftProPayload } from './softpro-payload';

/**
 * SoftPro always maps buyer → PrimaryBorrower* / SecondaryBorrower*.
 * Purchase used to render no Buyer fields, so handleSubmit sent empty
 * borrower state and SoftPro got TBD / blanks. Investigation of hub
 * Purchase orders in the last 14 days: 172 of 235 (73%) had no buyer.
 *
 * This test reconstructs the exact handleSubmit buyer mapping
 * (use-quick-entry.ts) and asserts the vendor payload — a rendered
 * field that does not reach createOrder is the failure mode this
 * integration has produced repeatedly.
 */

type Person = { firstName: string; middleName: string; lastName: string };

const EMPTY_PERSON: Person = { firstName: '', middleName: '', lastName: '' };

/** Must stay identical to use-quick-entry.ts handleSubmit `buyer: { ... }`. */
function buyerFromFormState(form: {
  borrower: Person;
  secBorrower: Person;
  hasSecBorrower: boolean;
  borrowerIsOrg: boolean;
  borrowerOrgType: string;
}) {
  return {
    firstName: form.borrower.firstName || 'TBD',
    middleName: form.borrower.middleName || undefined,
    lastName: form.borrower.lastName || 'TBD',
    secondaryFirstName: form.hasSecBorrower ? form.secBorrower.firstName || undefined : undefined,
    secondaryMiddleName: form.hasSecBorrower ? form.secBorrower.middleName || undefined : undefined,
    secondaryLastName: form.hasSecBorrower ? form.secBorrower.lastName || undefined : undefined,
    isOrganization: form.borrowerIsOrg,
    organizationType: form.borrowerOrgType || undefined,
  };
}

function purchaseFormPayload(buyer: ReturnType<typeof buyerFromFormState>) {
  return {
    orderType: 'Title only' as const,
    isRushOrder: false,
    property: {
      address: '419 Calle Delicada',
      city: 'San Clemente',
      state: 'CA',
      zip: '92673',
    },
    seller: { firstName: 'SiteX', lastName: 'Owner', isOrganization: false },
    buyer,
    transaction: {
      type: 'Purchase',
      product: 'Residential Resale',
      salesAmount: 850000,
      loanAmount: 680000,
      coverageAmount: 850000,
      branchCode: 'PCT',
    },
  };
}

function borrowerFields(payload: Record<string, unknown>) {
  const tx = payload.transactionDetails as Record<string, unknown>;
  return {
    PrimaryBorrowerFirstName: tx.PrimaryBorrowerFirstName,
    PrimaryBorrowerMiddleName: tx.PrimaryBorrowerMiddleName,
    PrimaryBorrowerLastName: tx.PrimaryBorrowerLastName,
    SecondaryBorrowerFirstName: tx.SecondaryBorrowerFirstName,
    SecondaryBorrowerMiddleName: tx.SecondaryBorrowerMiddleName,
    SecondaryBorrowerLastName: tx.SecondaryBorrowerLastName,
  };
}

function softproFromForm(form: Parameters<typeof buyerFromFormState>[0]) {
  const parsed = createOrderInputSchema.parse(purchaseFormPayload(buyerFromFormState(form)));
  return buildSoftProPayload(
    parsed,
    { apn: '123-456-789', legal: 'Lot 1', county: 'Orange' },
    {},
  );
}

describe('Purchase Buyer input reaches SoftPro transactionDetails', () => {
  it('BEFORE: empty Purchase borrower state writes TBD / blank PrimaryBorrower*', () => {
    const payload = softproFromForm({
      borrower: EMPTY_PERSON,
      secBorrower: EMPTY_PERSON,
      hasSecBorrower: false,
      borrowerIsOrg: false,
      borrowerOrgType: '',
    });
    const written = borrowerFields(payload);

    // Empty form → handleSubmit defaults → SoftPro still gets a write, but TBD.
    expect(written).toEqual({
      PrimaryBorrowerFirstName: 'TBD',
      PrimaryBorrowerMiddleName: '',
      PrimaryBorrowerLastName: 'TBD',
      SecondaryBorrowerFirstName: '',
      SecondaryBorrowerMiddleName: '',
      SecondaryBorrowerLastName: '',
    });
  });

  it('AFTER: Buyer names entered on Purchase write those names to Primary/SecondaryBorrower*', () => {
    const payload = softproFromForm({
      borrower: { firstName: 'Jordan', middleName: 'A', lastName: 'Reyes' },
      secBorrower: { firstName: 'Alex', middleName: '', lastName: 'Kim' },
      hasSecBorrower: true,
      borrowerIsOrg: false,
      borrowerOrgType: '',
    });
    const written = borrowerFields(payload);

    expect(written).toEqual({
      PrimaryBorrowerFirstName: 'Jordan',
      PrimaryBorrowerMiddleName: 'A',
      PrimaryBorrowerLastName: 'Reyes',
      SecondaryBorrowerFirstName: 'Alex',
      SecondaryBorrowerMiddleName: '',
      SecondaryBorrowerLastName: 'Kim',
    });
    expect(written.PrimaryBorrowerFirstName).not.toBe('TBD');
    expect(written.PrimaryBorrowerLastName).not.toBe('TBD');
  });

  it('Purchase Buyer fields bind the same borrower state handleSubmit sends to createOrder', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/admin/quick-entry/sections.tsx'),
      'utf8',
    );

    expect(source).toContain("const partyLabel = isPurchase ? 'Buyer' : 'Borrower'");
    expect(source).toContain('person={s.borrower}');
    expect(source).toContain('onChange={s.setBorrower}');
    expect(source).toContain('person={s.secBorrower}');
    expect(source).toContain('onChange={s.setSecBorrower}');
  });
});
