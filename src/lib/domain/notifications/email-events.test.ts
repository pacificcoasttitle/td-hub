import { describe, expect, it } from 'vitest';
import { OUTCOME_BY_EVENT, NOT_AN_OUTCOME, baseMessageId, reasonOf } from './email-events';

// The pure half: the two rules that decide whether this webhook works at all.
// The database half is covered by the route test, which drives ingestEvents
// through a recording db.

describe('matching an event to the send it belongs to', () => {
  // THE DEFECT THIS PREVENTS. We store the X-Message-Id header; SendGrid's
  // events carry that id with routing detail appended. Comparing them whole
  // matches nothing — and a webhook that matches nothing looks exactly like a
  // webhook that is working, because no news is what it reports either way.
  it('strips the routing suffix SendGrid appends', () => {
    expect(baseMessageId('abc123XYZ.filterdrecv-849fb9c5f-x8j4k-1-68A1B2C3-2.0'))
      .toBe('abc123XYZ');
  });

  it('leaves a bare id alone', () => {
    expect(baseMessageId('abc123XYZ')).toBe('abc123XYZ');
  });

  it('is what makes the two forms equal', () => {
    const stored = 'yZ9Q7RbGShGkFm1234abcd';
    const fromEvent = `${stored}.filterdrecv-abcdef-1234-ab-9876.0`;
    expect(baseMessageId(fromEvent)).toBe(stored);
    expect(fromEvent).not.toBe(stored); // the whole point
  });

  it('trims whitespace rather than producing an id that matches nothing', () => {
    expect(baseMessageId(' abc123 .suffix')).toBe('abc123');
  });
});

describe('which events change what a person is shown', () => {
  it('maps the four that mean something', () => {
    expect(OUTCOME_BY_EVENT.delivered).toBe('delivered');
    expect(OUTCOME_BY_EVENT.bounce).toBe('bounced');
    expect(OUTCOME_BY_EVENT.dropped).toBe('dropped');
    expect(OUTCOME_BY_EVENT.spamreport).toBe('spam');
  });

  it('does NOT treat deferred as an outcome', () => {
    // A deferral is SendGrid still trying. Showing it as an outcome would put
    // an alarming word against the ordinary case of a busy mail server.
    expect(OUTCOME_BY_EVENT.deferred).toBeUndefined();
    expect(NOT_AN_OUTCOME.has('deferred')).toBe(true);
  });

  it('ignores engagement events, which say nothing about arrival', () => {
    for (const e of ['open', 'click', 'unsubscribe', 'processed']) {
      expect(OUTCOME_BY_EVENT[e], e).toBeUndefined();
      expect(NOT_AN_OUTCOME.has(e), e).toBe(true);
    }
  });

  it('covers dropped, which is the silent case this build exists for', () => {
    // A suppressed address: SendGrid answers 202 and never tries. Seventeen of
    // these went unnoticed between April and September 2026.
    expect(OUTCOME_BY_EVENT.dropped).toBe('dropped');
  });
});

describe('the reason, in SendGrid\'s own words', () => {
  it('joins the type and the reason, because both matter to whoever rings the client', () => {
    expect(reasonOf({ type: 'blocked', reason: '550 5.1.1 User unknown' }))
      .toBe('blocked: 550 5.1.1 User unknown');
  });

  it('falls back to status when there is no reason', () => {
    expect(reasonOf({ type: 'bounce', status: '5.1.1' })).toBe('bounce: 5.1.1');
  });

  it('uses whichever single field is present', () => {
    expect(reasonOf({ reason: 'Bounced Address' })).toBe('Bounced Address');
    expect(reasonOf({ type: 'blocked' })).toBe('blocked');
  });

  it('returns null rather than an empty string when SendGrid says nothing', () => {
    expect(reasonOf({ event: 'delivered' })).toBeNull();
    expect(reasonOf({ reason: '   ' })).toBeNull();
  });
});
