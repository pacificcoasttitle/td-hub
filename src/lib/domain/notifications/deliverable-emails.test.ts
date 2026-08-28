import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_DELIVERABLE_EMAILS, isValidDeliverableEmail, normalizeEmail, validateDeliverableEmails,
} from './deliverable-emails';
import { buildConfirmationRecipients, OPEN_ORDERS_CONFIRMATION_CC } from './confirmation-recipients';

describe('validation', () => {
  it.each(['a@b.com', 'first.last@sub.example.co.uk', 'x+tag@example.com'])
    ('accepts %s', (e) => expect(isValidDeliverableEmail(e)).toBe(true));

  it.each(['not-an-email', 'missing@tld', '@example.com', 'a@b', 'a b@c.com', ''])
    ('rejects %s', (e) => expect(isValidDeliverableEmail(e)).toBe(false));

  it('normalises case and whitespace, because dedupe depends on it', () => {
    expect(normalizeEmail('  Escrow@BrightPath.COM ')).toBe('escrow@brightpath.com');
  });
});

describe('a submitted list', () => {
  it('separates the bad line from the good ones rather than failing the form', () => {
    const r = validateDeliverableEmails(['a@b.com', 'nope', 'c@d.com']);
    expect(r.valid).toEqual(['a@b.com', 'c@d.com']);
    expect(r.invalid).toEqual(['nope']);
  });

  it('blank rows are not errors — the form always has an empty last row', () => {
    expect(validateDeliverableEmails(['a@b.com', '', '   ']).invalid).toEqual([]);
  });

  it('the same address typed twice is not an error', () => {
    expect(validateDeliverableEmails(['A@b.com', 'a@B.com']).valid).toEqual(['a@b.com']);
  });

  it(`caps at ${MAX_DELIVERABLE_EMAILS}`, () => {
    const many = Array.from({ length: 9 }, (_, i) => `u${i}@x.com`);
    expect(validateDeliverableEmails(many).valid).toHaveLength(MAX_DELIVERABLE_EMAILS);
  });
});

describe('they land in CC, never TO', () => {
  const base = { clientEmail: 'client@example.com', salesRepEmail: 'rep@pct.com' };

  it('added to CC', () => {
    const r = buildConfirmationRecipients({
      ...base, deliverableEmails: ['escrow@brightpath.com', 'm@example.com'],
    });
    expect(r.cc).toContain('escrow@brightpath.com');
    expect(r.cc).toContain('m@example.com');
    expect(r.to).toEqual(['client@example.com']);
  });

  it('the responsible party keeps TO to itself', () => {
    const r = buildConfirmationRecipients({ ...base, deliverableEmails: ['x@y.com'] });
    expect(r.to).not.toContain('x@y.com');
  });

  it('never displaces the guaranteed CC', () => {
    const r = buildConfirmationRecipients({ ...base, deliverableEmails: ['x@y.com'] });
    expect(r.cc).toContain(OPEN_ORDERS_CONFIRMATION_CC);
  });

  it('with no client, openorders is still promoted to TO and deliverables stay in CC', () => {
    // The guaranteed-delivery invariant must not be reachable by adding a
    // deliverable address — a zero-recipient send stays impossible, and an
    // operator-typed address never becomes the primary recipient by accident.
    const r = buildConfirmationRecipients({ clientEmail: null, deliverableEmails: ['x@y.com'] });
    expect(r.to).toEqual([OPEN_ORDERS_CONFIRMATION_CC]);
    expect(r.cc).toContain('x@y.com');
    expect(r.clientRecipientPresent).toBe(false);
  });

  it('an address already in TO is not duplicated into CC', () => {
    const r = buildConfirmationRecipients({
      ...base, deliverableEmails: ['client@example.com'],
    });
    expect(r.cc).not.toContain('client@example.com');
  });

  it('case differences do not produce a duplicate', () => {
    const r = buildConfirmationRecipients({
      ...base, deliverableEmails: ['CLIENT@example.com'],
    });
    expect(r.cc.filter((e) => e === 'client@example.com')).toHaveLength(0);
  });

  it('absent or empty changes nothing', () => {
    const a = buildConfirmationRecipients(base);
    const b = buildConfirmationRecipients({ ...base, deliverableEmails: [] });
    expect(b).toEqual(a);
  });
});

// ─── The hard rule, proven structurally ─────────────────────────────────────

describe('the send path cannot take an address from a request', () => {
  const src = readFileSync(join(__dirname, 'deliverable-emails.ts'), 'utf8');

  it('the send loader takes an order id and nothing else', () => {
    // Source-sliced deliberately: this is an INTERFACE claim, which is the one
    // thing reading source is genuinely good for. A rendered test could not
    // show that no other parameter exists.
    const sig = src.match(/export async function deliverableEmailsForSend\(([^)]*)\)/);
    expect(sig, 'deliverableEmailsForSend not found').not.toBeNull();
    expect(sig![1].replace(/\s+/g, ' ').trim()).toBe('orderId: number');
  });

  it('every read filters removed_at, so a removal takes effect on the next send', () => {
    expect(src).toContain('isNull(orderDeliverableEmails.removedAt)');
  });
});
