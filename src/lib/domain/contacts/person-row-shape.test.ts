import { describe, expect, it } from 'vitest';
import { describePersonRowRejection, validatePersonRowShape } from './person-row-shape';

/** The real AasNarApp row from the production feed, 2026-09-15: shifted several columns. */
function shiftedTestRow(overrides: Record<string, string> = {}) {
  return {
    LookupCode: 'AasNarApp',
    FirstName: 'Aashima',
    LastName: 'Narang',
    Email: '9879543210',
    Phone: '',
    GenderID: 'aashimanarang@yopmail.com',
    Address1: 'Escrow Officer',
    Address2: '22632 Golden Springs Drive, Suite 310',
    City: '',
    State: 'Diamond Bar',
    Zip: 'CA',
    'Row State': 'Unchanged',
    ...overrides,
  };
}

/** A well-formed row: AasNarApps88 from the same page, which is aligned. */
function wellFormedRow(overrides: Record<string, string> = {}) {
  return {
    LookupCode: 'AasNarApps88',
    FirstName: 'Aashi',
    LastName: 'Narang',
    Email: 'aashimanarang9090@yopmail.com',
    Phone: '9879543210',
    GenderID: '',
    Address1: '22632 Golden Springs Drive, Suite 310',
    Address2: '',
    City: 'Diamond Bar',
    State: 'CA',
    Zip: '91765',
    'Row State': 'Unchanged',
    ...overrides,
  };
}

describe('validatePersonRowShape', () => {
  it('rejects the shifted row, and says which columns moved', () => {
    const result = validatePersonRowShape(shiftedTestRow());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(' ')).toContain("column 'Email' does not hold an email address");
    // The email in GenderID is why this row failed on a length limit rather
    // than on its shape, so the escalation names it.
    expect(result.reasons.join(' ')).toContain("column 'GenderID' holds an email address");
  });

  it('accepts the aligned row beside it on the same page', () => {
    expect(validatePersonRowShape(wellFormedRow())).toEqual({ ok: true });
  });

  it('accepts a row with no email at all — that is skipped, not malformed', () => {
    // syncOpenContacts skips rows with no email. Rejecting them instead would
    // turn a quiet skip into thousands of escalations.
    expect(validatePersonRowShape(wellFormedRow({ Email: '' })).ok).toBe(true);
  });

  it('rejects a Row State sentinel sitting in a data column', () => {
    const result = validatePersonRowShape(wellFormedRow({ FirstName: 'Unchanged' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(' ')).toContain("column 'FirstName' holds the Row State sentinel");
  });

  it('does not reject a real address, name or phone for containing punctuation', () => {
    expect(validatePersonRowShape(wellFormedRow({
      FirstName: "Mary-Jane", LastName: "O'Brien", Phone: '(909) 555-1212',
      Address1: '22632 Golden Springs Drive, Suite 310', City: 'Diamond Bar',
    })).ok).toBe(true);
  });

  it('rejects an email with a space, which is not a deliverable address', () => {
    expect(validatePersonRowShape(wellFormedRow({ Email: 'two addresses@example.com' })).ok).toBe(false);
  });
});

describe('describePersonRowRejection', () => {
  it('names the contact, says not imported, and says escalate', () => {
    const message = describePersonRowRejection('AasNarApp', ["column 'Email' does not hold an email address"]);
    expect(message).toContain('AasNarApp');
    expect(message).toContain('REJECTED for shape (not imported)');
    expect(message).toContain('Escalate to SoftPro');
  });
});
