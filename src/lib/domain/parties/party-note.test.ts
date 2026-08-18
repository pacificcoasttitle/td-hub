import { describe, expect, it } from 'vitest';
import { buildPartyNote, PARTY_NOTE_MARKER, roleLabel } from './party-note';

const at = new Date('2026-08-18T21:30:00Z');

const base = {
  role: 'listing_agent' as const,
  name: 'Jane Smith',
  company: 'Coast Realty',
  email: 'jane@brokerage.com',
  phone: '5625550101',
  submitterEmail: 'jane@brokerage.com',
  submittedAt: at,
};

describe('party note', () => {
  it('opens with the stable marker so these notes can be found later', () => {
    expect(buildPartyNote(base).startsWith(PARTY_NOTE_MARKER)).toBe(true);
  });

  it('includes every supplied field', () => {
    const note = buildPartyNote(base);
    expect(note).toContain('Name: Jane Smith');
    expect(note).toContain('Company: Coast Realty');
    expect(note).toContain('Email: jane@brokerage.com');
    expect(note).toContain('Phone: 5625550101');
  });

  it('omits absent fields rather than printing empty labels', () => {
    const note = buildPartyNote({ ...base, company: null, phone: null });
    expect(note).not.toContain('Company:');
    expect(note).not.toContain('Phone:');
    expect(note).toContain('Name: Jane Smith');
  });

  it('suppresses "Submitted by" when it is the same person', () => {
    expect(buildPartyNote(base)).not.toContain('Submitted by');
  });

  it('shows "Submitted by" when someone else filled the form in', () => {
    const note = buildPartyNote({ ...base, submitterEmail: 'assistant@brokerage.com' });
    expect(note).toContain('Submitted by: assistant@brokerage.com');
  });

  it('ignores case when deciding whether the submitter differs', () => {
    const note = buildPartyNote({ ...base, submitterEmail: 'JANE@Brokerage.com' });
    expect(note).not.toContain('Submitted by');
  });

  it('includes a seller contact when the agent supplied one', () => {
    const note = buildPartyNote({
      ...base,
      seller: { name: 'Sam Seller', email: 'sam@example.com', phone: null },
    });
    expect(note).toContain('Seller contact (provided by the agent):');
    expect(note).toContain('Name: Sam Seller');
    expect(note).toContain('Email: sam@example.com');
  });

  it('omits the seller block entirely when nothing was given', () => {
    const note = buildPartyNote({ ...base, seller: { name: null, email: null, phone: null } });
    expect(note).not.toContain('Seller contact');
  });

  it('states plainly that this is NOT yet on the SoftPro contact record', () => {
    // The escrow officer must not assume the party is attached in SoftPro,
    // because updateOrder cannot do that yet.
    expect(buildPartyNote(base)).toContain('Not yet written to the SoftPro contact record');
  });

  it('renders a Pacific-time timestamp regardless of server locale', () => {
    expect(buildPartyNote(base)).toMatch(/Received Aug 18, 2026 at \d{1,2}:\d{2} (AM|PM) PT\./);
  });

  it('is plain text — no markup leaks into the notes panel', () => {
    const note = buildPartyNote(base);
    expect(note).not.toMatch(/<[a-z/]/i);
  });

  it('labels roles for humans', () => {
    expect(roleLabel('listing_agent')).toBe('Listing agent');
    expect(roleLabel('buyer_agent')).toBe('Buyer agent');
  });
});
