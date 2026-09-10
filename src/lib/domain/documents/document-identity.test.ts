import { describe, expect, it } from 'vitest';
import { identifyDocument, isSafeToDeliver, MIN_TEXT_CHARS } from './document-identity';

/**
 * Every fixture below is the real opening text of a real document in
 * production, read out of S3 on 2026-09-10. The document id is given so any
 * claim here can be checked against the file itself.
 */
// Padding is real words, not whitespace: identifyDocument collapses runs of
// whitespace before measuring, so space padding would not reach the minimum.
const FILLER = 'and the parties hereto agree to the terms set forth herein. ';
const pad = (s: string) => {
  let out = s;
  while (out.length < MIN_TEXT_CHARS + 50) out += FILLER;
  return out;
};

// doc #4751 — delivered to ana@anescrow.com as a prelim. It WAS a prelim.
const DNU_THAT_IS_A_PRELIM = pad(
  'CLTA Preliminary Report Form - Modified (11/17/06)Page 120020526-GLT 516 Burchett St '
  + 'Glendale, CA 91203 Title Officer: Richard Dickerson Title Phone: (866)724-1050 Title Email: '
  + 'Title Order No.: 20020526-GLT Issuing Policies of Westcor Land Title Insurance Company',
);

// doc #4897 — delivered to achacon@premescrow.com as a prelim. It was NOT.
const ORDER_SUMMARY = pad(
  'Order Summary Document generated:08/11/26 Order number:20020875-GLT Order type:Title only '
  + 'Transaction type:Refinance Settlement date:09/14/26at08:00 AM Disbursement date:09/14/26 '
  + 'Marketing source:Referral Marketing Rep:Kevin Green Office:Pacific Coast Title Company',
);

// doc #4708 — a lender's document. SoftPro calls it "Loan", never "Lender".
const LOAN_POLICY = pad(
  'Copyright 2006 - 2012 American Land Title Association. All rights reserved. The use of this '
  + 'Form is restricted to ALTA licensees and ALTA members in good standing as of the date of use. '
  + 'OCT RESIDENTIAL LIMITED COVERAGE JUNIOR LOAN POLICY SCHEDULE A Name and Address of Title '
  + 'Insurance Company Any notice of claim and any other notice',
);

// doc #2193
const SUPPLEMENT = pad(
  'Supplemental20004595-OCT 1111 E. Katella Ave Ste 120 Orange, CA 92867 (714)516-6700 '
  + 'Issuing Agent for Westcor Land Title Insurance Company TITLE OFFICE:Pacific Coast Title Company',
);

// doc #7805
const CPL = pad(
  'AmericanLandTitleAssociationClosingProtectionLetter-SingleTransaction 2018v.02.00(04-02-2021) '
  + 'Adopted04-02-2021 CPL-ST-2021ALTAClosingProtectionLetter-SingleTransaction',
);

// doc #7809 — a TitlePoint scan. Four characters of extractable text.
const IMAGE_ONLY = '\f  \n';

describe('identifyDocument', () => {
  it('identifies a prelim by its form header, whatever the file is called', () => {
    const id = identifyDocument(DNU_THAT_IS_A_PRELIM);
    expect(id.type).toBe('clta_preliminary_report');
    expect(id.matchedOn).toContain('CLTA Preliminary Report Form');
  });

  // THE REGRESSION. This document passed the old check on three supporting
  // markers and was emailed to an outside escrow company as a title report.
  it('refuses an internal Order Summary, which the old marker count passed', () => {
    const id = identifyDocument(ORDER_SUMMARY);
    expect(id.type).toBe('order_summary');
    expect(id.type).not.toBe('clta_preliminary_report');
  });

  // THE OTHER HALF. Legacy's filename rule would call this an owner's policy —
  // it contains "policy" and not "lender" — and mail it to the property owner.
  it("identifies a loan policy as a lender's document, not an owner's", () => {
    const id = identifyDocument(LOAN_POLICY);
    expect(id.type).toBe('alta_loan_policy');
    expect(id.type).not.toBe('alta_owners_policy');
    expect(id.type).not.toBe('clta_preliminary_report');
  });

  it('identifies a supplement statement', () => {
    expect(identifyDocument(SUPPLEMENT).type).toBe('supplement_statement');
  });

  it('identifies a closing protection letter', () => {
    expect(identifyDocument(CPL).type).toBe('closing_protection_letter');
  });

  it('refuses a scan with no extractable text rather than guessing', () => {
    const id = identifyDocument(IMAGE_ONLY);
    expect(id.type).toBe('unidentified');
    expect(id.reason).toBe('no_extractable_text');
  });

  it('refuses a document whose text matches nothing', () => {
    const id = identifyDocument(pad('Dear Sir, please find enclosed the documents you requested.'));
    expect(id.type).toBe('unidentified');
    expect(id.reason).toBe('no_signature_matched');
  });

  // Not knowing is a valid answer; picking one of two is not. Both signatures
  // have to fall inside their own window for this to be genuine ambiguity —
  // a prelim that merely MENTIONS a policy form later on is not ambiguous, and
  // there is a separate test below for that.
  it('refuses when two types both claim the document', () => {
    const both = pad('Order Summary Document generated:08/11/26 '
      + 'CLTA Preliminary Report Form - Modified (11/17/06) Page 1');
    const id = identifyDocument(both);
    expect(id.type).toBe('unidentified');
    expect(id.reason).toBe('multiple_signatures_matched');
    expect(id.candidates).toContain('order_summary');
    expect(id.candidates).toContain('clta_preliminary_report');
  });

  // THE FALSE-NEGATIVE REGRESSION. The first version of this module searched
  // the whole document and refused 31 of 40 genuine prelims, because a prelim
  // names the ALTA policy forms that will be issued from it. Searching the
  // whole text finds every type MENTIONED; searching the opening finds the
  // type it IS.
  it('identifies a prelim that mentions a loan policy in its body', () => {
    const prelim = DNU_THAT_IS_A_PRELIM
      + ' '.repeat(1) + 'x'.repeat(1500)
      + ' the Company will issue an ALTA RESIDENTIAL LIMITED COVERAGE JUNIOR LOAN POLICY '
      + "and an ALTA Owner's Policy of Title Insurance upon recordation.";
    const id = identifyDocument(prelim);
    expect(id.type).toBe('clta_preliminary_report');
  });

  it('never counts shared title vocabulary as identification', () => {
    // Four of the old check's seven supporting markers, which was enough to
    // pass. Positive identification finds nothing here, correctly.
    const shared = pad(
      'Schedule B exceptions effective date policy of title insurance legal description '
      + 'vesting title to said estate is vested in the parties named herein.',
    );
    expect(identifyDocument(shared).type).toBe('unidentified');
  });
});

describe('unvalidated signatures', () => {
  // An owner's policy is the one document in this system addressed to a named
  // individual, and its signature has never matched a real file. Being
  // probably right about who owns a property is not good enough.
  it("marks an owner's policy identification as unvalidated", () => {
    const owners = pad(
      'Copyright 2021 American Land Title Association. All rights reserved. '
      + "ALTA Owner's Policy of Title Insurance SCHEDULE A Name and Address of Title "
      + 'Insurance Company',
    );
    const id = identifyDocument(owners);
    expect(id.type).toBe('alta_owners_policy');
    expect(id.validated).toBe(false);
    expect(isSafeToDeliver(id, 'alta_owners_policy')).toBe(false);
  });

  it('marks a loan policy as validated — it has matched real documents', () => {
    const id = identifyDocument(LOAN_POLICY);
    expect(id.type).toBe('alta_loan_policy');
    expect(id.validated).toBe(true);
    expect(isSafeToDeliver(id, 'alta_loan_policy')).toBe(true);
  });

  it('refuses when the type is right but it is not the type asked for', () => {
    expect(isSafeToDeliver(identifyDocument(ORDER_SUMMARY), 'clta_preliminary_report')).toBe(false);
  });
});
