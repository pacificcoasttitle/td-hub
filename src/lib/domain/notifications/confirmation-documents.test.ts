import { describe, expect, it } from 'vitest';
import {
  hasOutstandingDocuments,
  OUTSTANDING_DOCUMENTS_SENTENCE,
  CONFIRMATION_OPTIONAL_DOC_TYPES,
} from './confirmation-documents';
import { orderConfirmationTemplate } from './confirmation-template';

/** Minimal, explicit. A test fixture should not depend on a sample file. */
const BASE = {
  fileNumber: '20021653-GLT',
  transactionType: 'Purchase',
  property: {
    address: '1815 Holmby Ave', city: 'Los Angeles', zip: '90024',
    county: 'Los Angeles', apn: '4317-003-061', legalDescription: 'Lot 4',
  },
  seller: { primary: 'MCCLENTON MARIE S', secondary: null },
  parties: { escrow: { name: 'Ana Ortega', email: 'ana@anescrow.com', phone: null, company: 'An Escrow' } },
  assignments: { salesRep: 'Team Meza', titleOfficer: 'PCT\jjean' },
  isTitlePointActive: true,
};

// ─── Outstanding is not the same as missing ─────────────────────────────────

describe('a promise is only made when something is actually coming', () => {
  it('all three attached — nothing outstanding', () => {
    expect(hasOutstandingDocuments(['legal_vesting', 'tax', 'grant_deed'])).toBe(false);
  });

  it('NO qualifying grant deed is NOT outstanding', () => {
    // Order 20021675-GLT: lv=1 tax=1 gd=0. The LV found no qualifying deed, so
    // nothing is coming. Promising it would be a promise nobody can keep.
    expect(hasOutstandingDocuments(['legal_vesting', 'tax'])).toBe(false);
  });

  it('a FAILED legal & vesting IS outstanding, even though tax arrived', () => {
    // The case a zero-attached test would miss entirely.
    expect(hasOutstandingDocuments(['tax', 'grant_deed'])).toBe(true);
    expect(hasOutstandingDocuments(['tax'])).toBe(true);
  });

  it('a failed tax is outstanding too', () => {
    expect(hasOutstandingDocuments(['legal_vesting', 'grant_deed'])).toBe(true);
  });

  it('nothing attached is the common case of the rule, not the rule', () => {
    expect(hasOutstandingDocuments([])).toBe(true);
  });

  it('the optional list is what carries the distinction', () => {
    // If grant_deed ever stops being optional this test fails loudly rather
    // than the behaviour changing silently.
    expect([...CONFIRMATION_OPTIONAL_DOC_TYPES]).toEqual(['grant_deed']);
  });
});

describe('the sentence a customer reads', () => {
  it('is exactly the approved wording', () => {
    expect(OUTSTANDING_DOCUMENTS_SENTENCE).toBe(
      'Pacific Coast Title will send the title documents for this property separately.',
    );
  });

  it('promises no count, no names and no timeframe', () => {
    const s = OUTSTANDING_DOCUMENTS_SENTENCE;
    expect(s).not.toMatch(/three|3|Legal|Vesting|Grant|Tax/);
    expect(s).not.toMatch(/hour|day|shortly|soon|within/i);
    // Not an apology, and not an error report.
    expect(s).not.toMatch(/sorry|apolog|unfortunately|error|failed|unable/i);
  });
});

// ─── The rendered email ─────────────────────────────────────────────────────

describe('the body says what is enclosed and what is coming', () => {
  const render = (over: Record<string, unknown>) =>
    orderConfirmationTemplate({ ...BASE, ...over } as never).html;

  it('names the enclosed PDFs — the field that rendered nowhere until now', () => {
    const html = render({
      attachedDocLabels: ['Legal and Vesting', 'Tax Roll', 'Recent Grant Deed'],
      hasDocuments: true,
      hasOutstandingDocuments: false,
    });
    expect(html).toContain('Documents');
    expect(html).toContain('Legal and Vesting, Tax Roll and Recent Grant Deed');
    expect(html).not.toContain(OUTSTANDING_DOCUMENTS_SENTENCE);
  });

  it('LV + tax with no qualifying deed: lists them, promises nothing', () => {
    const html = render({
      attachedDocLabels: ['Legal and Vesting', 'Tax Roll'],
      hasDocuments: true,
      hasOutstandingDocuments: false,
    });
    expect(html).toContain('Legal and Vesting and Tax Roll');
    expect(html).not.toContain(OUTSTANDING_DOCUMENTS_SENTENCE);
  });

  it('nothing attached: the sentence, and no empty enclosed list', () => {
    const html = render({
      attachedDocLabels: [],
      hasDocuments: false,
      hasOutstandingDocuments: true,
    });
    expect(html).toContain(OUTSTANDING_DOCUMENTS_SENTENCE);
    expect(html).not.toContain('Enclosed with this email');
  });

  it('partial with a failed LV: both halves', () => {
    const html = render({
      attachedDocLabels: ['Tax Roll'],
      hasDocuments: true,
      hasOutstandingDocuments: true,
    });
    expect(html).toContain('Enclosed with this email: Tax Roll.');
    expect(html).toContain(OUTSTANDING_DOCUMENTS_SENTENCE);
  });

  it('no Documents section at all when there is nothing to say', () => {
    const html = render({ attachedDocLabels: [], hasDocuments: false, hasOutstandingDocuments: false });
    expect(html).not.toContain('Enclosed with this email');
    expect(html).not.toContain(OUTSTANDING_DOCUMENTS_SENTENCE);
  });
});
