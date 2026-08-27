import { describe, expect, it } from 'vitest';
import {
  classifyLinkState,
  counterpartLabel,
  isPacificCoast,
  resolveCounterpartName,
  resolveWizardContact,
  usablePhone,
  type WizardContactSource,
} from './party-wizard-context';

/**
 * Fixtures are REAL production shapes, verified by query against the 4,611
 * candidate orders (opened in the last 180 days with no listing agent on file):
 *
 *   escrow officer on the order      1,970 / 4,611  42.7%   all with email
 *   ... on a pct.com address           551 / 4,611  12.0%
 *   ... at an outside escrow company 1,419 / 4,611  30.8%
 *   ... with a company_name            895 / 1,970  45.4%
 *   ... with a usable phone          1,438 / 4,611  31.2%
 *   ... with a junk phone               66          e.g. "000-000-0000"
 *   title officer with email         4,434 / 4,611  96.2%
 *   contacts.title / phone_ext / cell      0        every single candidate
 */
function source(over: Partial<WizardContactSource> = {}): WizardContactSource {
  return {
    escrowOfficerName: null,
    escrowOfficerEmail: null,
    escrowOfficerPhone: null,
    escrowOfficerCompany: null,
    titleOfficerName: null,
    titleOfficerEmail: null,
    ...over,
  };
}

// Real rows from order_parties / contacts.
const OUTSIDE_OFFICER = source({
  escrowOfficerName: 'Rose Lucero',
  escrowOfficerEmail: 'rose@powerhouseescrow.com',
  escrowOfficerPhone: '(818) 643-3225',
  escrowOfficerCompany: 'Powerhouse Escrow',
  titleOfficerName: 'Dana Reyes',
  titleOfficerEmail: 'dreyes@pct.com',
});

describe('contact ladder — tier 1, the escrow officer', () => {
  it('names an outside escrow officer with their company, which is the whole point', () => {
    const c = resolveWizardContact(OUTSIDE_OFFICER);
    expect(c).toEqual({
      name: 'Rose Lucero',
      company: 'Powerhouse Escrow',
      email: 'rose@powerhouseescrow.com',
      phone: '(818) 643-3225',
      kind: 'escrow_officer',
    });
  });

  it('suppresses the company for one of our own — "Pacific Coast Title" next to a PCT officer is noise', () => {
    const c = resolveWizardContact(source({
      escrowOfficerName: 'Maria Ortiz',
      escrowOfficerEmail: 'mortiz@pct.com',
      escrowOfficerCompany: 'Pacific Coast Title Company',
    }));
    expect(c?.company).toBeNull();
    expect(c?.name).toBe('Maria Ortiz');
    expect(c?.kind).toBe('escrow_officer');
  });

  it('drops to the title officer when the escrow officer has a name but no email — a name we cannot reach is not a contact', () => {
    const c = resolveWizardContact(source({
      escrowOfficerName: 'Rose Lucero',
      escrowOfficerEmail: null,
      titleOfficerName: 'Dana Reyes',
      titleOfficerEmail: 'dreyes@pct.com',
    }));
    expect(c?.kind).toBe('title_officer');
    expect(c?.name).toBe('Dana Reyes');
  });
});

describe('contact ladder — tier 2 and the floor', () => {
  it('falls to the title officer on the 57.3% of orders with no escrow officer at all', () => {
    const c = resolveWizardContact(source({
      titleOfficerName: 'Dana Reyes',
      titleOfficerEmail: 'dreyes@pct.com',
    }));
    expect(c).toEqual({
      name: 'Dana Reyes',
      company: null,
      email: 'dreyes@pct.com',
      phone: null,
      kind: 'title_officer',
    });
  });

  it('never claims a phone for the title officer — the column is 3.9% filled and was never promised', () => {
    const c = resolveWizardContact(source({
      titleOfficerName: 'Dana Reyes',
      titleOfficerEmail: 'dreyes@pct.com',
    }));
    expect(c?.phone).toBeNull();
  });

  it('returns null when nothing resolves, so the block can say so instead of rendering an empty card', () => {
    expect(resolveWizardContact(source())).toBeNull();
  });

  it('treats whitespace-only columns as absent all the way down the ladder', () => {
    expect(resolveWizardContact(source({
      escrowOfficerName: '  ',
      escrowOfficerEmail: '   ',
      titleOfficerName: '',
      titleOfficerEmail: '  ',
    }))).toBeNull();
  });
});

describe('the no-phone case, which is the common one', () => {
  it('keeps the escrow officer and simply omits the phone — 68.8% of orders land here', () => {
    const c = resolveWizardContact(source({
      escrowOfficerName: 'Galen Callahan',
      escrowOfficerEmail: 'galen@805escrow.com',
      escrowOfficerCompany: '805 Escrow',
      escrowOfficerPhone: null,
    }));
    expect(c?.name).toBe('Galen Callahan');
    expect(c?.phone).toBeNull();
  });

  it('drops the production placeholder numbers rather than printing them', () => {
    // Both of these are real values on real escrow officer rows.
    expect(usablePhone('000000000')).toBeNull();
    expect(usablePhone('000-000-0000')).toBeNull();
  });

  it('drops anything short of ten digits', () => {
    expect(usablePhone('555-1234')).toBeNull();
    expect(usablePhone('x2231')).toBeNull();
  });

  it('keeps a real number exactly as typed — reformatting it would be indistinguishable from getting it wrong', () => {
    expect(usablePhone('(909) 373-1200')).toBe('(909) 373-1200');
    expect(usablePhone('626-648-3808')).toBe('626-648-3808');
    expect(usablePhone(' 909-551-8522 ')).toBe('909-551-8522');
  });
});

describe('who counts as us', () => {
  it('recognises PCT by mail domain', () => {
    expect(isPacificCoast('mortiz@pct.com', null)).toBe(true);
    expect(isPacificCoast('someone@mail.pct.com', null)).toBe(true);
    expect(isPacificCoast('someone@pctitle.com', null)).toBe(true);
  });

  it('recognises PCT by company name when the address does not say so', () => {
    expect(isPacificCoast('m.ortiz@gmail.com', 'Pacific Coast Title Company')).toBe(true);
  });

  it('does not mistake an outside escrow company for us', () => {
    expect(isPacificCoast('rose@powerhouseescrow.com', 'Powerhouse Escrow')).toBe(false);
    expect(isPacificCoast('joyce@us-escrow.com', 'U.S. Escrow Group, Inc.')).toBe(false);
  });
});

describe('the counterpart name', () => {
  it('reads a comma-delimited owner in natural order', () => {
    // order 7420, primary_owner "JIMENEZ, ALEX DORADO"
    expect(resolveCounterpartName('listing_agent', 'JIMENEZ, ALEX DORADO'))
      .toBe('Alex Dorado Jimenez');
  });

  it('flips a positional owner and takes only the FIRST — the second is where the parse breaks', () => {
    // order 7408. order_parties holds "James R Saler" AND a mangled "D Melissa";
    // only the first is rendered, and this is why.
    expect(resolveCounterpartName('listing_agent', 'SALER JAMES R & MELISSA D'))
      .toBe('James R Saler');
  });

  it('is absent, not wrong, when there is no owner on the file', () => {
    expect(resolveCounterpartName('listing_agent', null)).toBeNull();
    expect(resolveCounterpartName('listing_agent', '')).toBeNull();
    expect(resolveCounterpartName('listing_agent', '   ')).toBeNull();
  });

  it('renders nothing for an entity owner rather than "Trust Llc Pacific"', () => {
    expect(resolveCounterpartName('listing_agent', 'PACIFIC TRUST LLC')).toBeNull();
    expect(resolveCounterpartName('listing_agent', 'B & A GROUP INC,')).toBeNull();
    expect(resolveCounterpartName('listing_agent', 'SMITH FAMILY REVOCABLE TRUST')).toBeNull();
    expect(resolveCounterpartName('listing_agent', 'WELLS FARGO BANK NA')).toBeNull();
  });

  it('renders nothing for a single-token owner — "Representing Saler" confirms nothing', () => {
    expect(resolveCounterpartName('listing_agent', 'SALER')).toBeNull();
  });

  it('renders nothing for any role that has no form yet, whatever the owner says', () => {
    expect(resolveCounterpartName('buyer_agent', 'JIMENEZ, ALEX DORADO')).toBeNull();
    expect(resolveCounterpartName('buyer', 'JIMENEZ, ALEX DORADO')).toBeNull();
    expect(resolveCounterpartName('seller', 'JIMENEZ, ALEX DORADO')).toBeNull();
  });

  it('labels the listing agent’s counterpart as the party they represent', () => {
    expect(counterpartLabel('listing_agent')).toBe('Representing');
  });
});

describe('link state — revoked and expired are one outcome', () => {
  const NOW = new Date('2026-08-26T12:00:00Z');
  const FUTURE = new Date('2026-10-25T12:00:00Z');
  const PAST = new Date('2026-06-01T12:00:00Z');

  it('is active only when it is neither revoked nor past its expiry', () => {
    expect(classifyLinkState({ revokedAt: null, expiresAt: FUTURE }, NOW)).toBe('active');
  });

  it('gives revoked and expired the SAME answer, so the page cannot tell them apart', () => {
    const revoked = classifyLinkState({ revokedAt: new Date('2026-08-01'), expiresAt: FUTURE }, NOW);
    const expired = classifyLinkState({ revokedAt: null, expiresAt: PAST }, NOW);
    expect(revoked).toBe('inactive');
    expect(expired).toBe('inactive');
    expect(revoked).toBe(expired);
  });

  it('treats the exact expiry instant as already gone', () => {
    expect(classifyLinkState({ revokedAt: null, expiresAt: NOW }, NOW)).toBe('inactive');
  });
});
