import { describe, expect, it } from 'vitest';
import { buildMailto, MAX_MAILTO_URL } from './mailto';

describe('buildMailto — encoding', () => {
  it('encodes recipient, subject and body', () => {
    const { href } = buildMailto({
      to: 'paul@escrowforum.com',
      subject: 'Following up',
      body: 'Hi Paul,\n\nJust checking in.\n\nAngeline',
    });
    expect(href.startsWith('mailto:paul%40escrowforum.com?')).toBe(true);
    expect(href).toContain('subject=Following%20up');
    // Newlines must be encoded, or the URL breaks at the first line ending.
    expect(href).toContain('%0A');
    expect(href).not.toMatch(/\n/);
  });

  it('encodes characters that would otherwise split the query string', () => {
    const { href } = buildMailto({
      to: 'a@b.com',
      subject: 'Q3 & Q4 — 50% done?',
      body: 'one=two&three#four',
    });
    // A raw & or # would truncate the body in the mail client.
    const body = new URL(href).searchParams.get('body');
    expect(body).toBe('one=two&three#four');
    expect(new URL(href).searchParams.get('subject')).toBe('Q3 & Q4 — 50% done?');
  });

  it('round-trips unicode', () => {
    const { href } = buildMailto({ to: 'a@b.com', body: 'Café — naïve — 日本語' });
    expect(new URL(href).searchParams.get('body')).toBe('Café — naïve — 日本語');
  });

  it('omits empty params rather than sending blanks', () => {
    expect(buildMailto({ to: 'a@b.com' }).href).toBe('mailto:a%40b.com');
    expect(buildMailto({ to: 'a@b.com', subject: '   ' }).href).toBe('mailto:a%40b.com');
  });
});

describe('buildMailto — missing recipient degrades, never errors', () => {
  it('still returns a usable href when the client has no email', () => {
    const r = buildMailto({ to: null, subject: 'Hello', body: 'Hi there' });
    expect(r.missingRecipient).toBe(true);
    expect(r.href.startsWith('mailto:?')).toBe(true);
    // The subject and body still travel — the rep types the address in Outlook.
    expect(new URL(r.href).searchParams.get('body')).toBe('Hi there');
  });

  it('treats blank and whitespace-only addresses as missing', () => {
    expect(buildMailto({ to: '' }).missingRecipient).toBe(true);
    expect(buildMailto({ to: '   ' }).missingRecipient).toBe(true);
  });
});

describe('buildMailto — length guard', () => {
  it('leaves a normal draft untouched', () => {
    const body = 'Hi Paul,\n\n'.repeat(10) + 'Angeline';
    const r = buildMailto({ to: 'paul@escrowforum.com', subject: 'Catching up', body });
    expect(r.truncated).toBe(false);
    expect(new URL(r.href).searchParams.get('body')).toBe(body.trim());
  });

  it('trims an over-long body to fit the URL budget', () => {
    const r = buildMailto({ to: 'a@b.com', subject: 'Long', body: 'x'.repeat(5000) });
    expect(r.truncated).toBe(true);
    expect(r.href.length).toBeLessThanOrEqual(MAX_MAILTO_URL);
  });

  it('budgets on ENCODED length, not character count', () => {
    // Newlines cost 3 chars each once encoded (%0A), so a body well under the
    // character budget can still blow the URL.
    const body = 'a\n'.repeat(600); // 1200 chars raw, ~2400 encoded
    const r = buildMailto({ to: 'a@b.com', body });
    expect(body.length).toBeLessThan(MAX_MAILTO_URL);
    expect(r.truncated).toBe(true);
    expect(r.href.length).toBeLessThanOrEqual(MAX_MAILTO_URL);
  });

  it('trims the body but never the subject or recipient', () => {
    const subject = 'Quarterly check-in on your files';
    const r = buildMailto({ to: 'paul@escrowforum.com', subject, body: 'y'.repeat(4000) });
    expect(r.truncated).toBe(true);
    expect(new URL(r.href).searchParams.get('subject')).toBe(subject);
    expect(r.href.startsWith('mailto:paul%40escrowforum.com')).toBe(true);
  });

  it('produces the LONGEST body that still fits', () => {
    const r = buildMailto({ to: 'a@b.com', body: 'z'.repeat(5000) });
    const kept = new URL(r.href).searchParams.get('body')!.length;
    // One more character would push it over.
    const oneMore = buildMailto({ to: 'a@b.com', body: 'z'.repeat(kept + 1) });
    expect(r.href.length).toBeLessThanOrEqual(MAX_MAILTO_URL);
    expect(oneMore.href.length).toBeLessThanOrEqual(MAX_MAILTO_URL);
    expect(kept).toBeGreaterThan(1000);
  });
});
