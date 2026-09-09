/**
 * The rules that decide whether PCT's team hears about a document the
 * customer never got.
 *
 * These assertions are the feature. The scanner around them is plumbing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OUTSTANDING_ALERT_EVENT_TYPE,
  OUTSTANDING_ALERT_FALLBACK_MINUTES,
  buildOutstandingAlertEmail,
  decideOutstandingAlert,
  missingFromConfirmation,
} from './outstanding-documents-alert';

const ALL = ['legal_vesting', 'tax', 'grant_deed'];

describe('when the alert fires', () => {
  it('stays silent while the document is still coming', () => {
    // The common case in the first minute. Firing now would tell a person
    // about a document they cannot yet send.
    const d = decideOutstandingAlert({
      missingAtSend: ['legal_vesting', 'grant_deed'],
      presentNow: ['tax'],
      minutesSinceSend: 0.5,
    });
    expect(d.fire).toBe(false);
  });

  it('fires the moment the promised documents are all in hand', () => {
    const d = decideOutstandingAlert({
      missingAtSend: ['legal_vesting', 'grant_deed'],
      presentNow: ALL,
      minutesSinceSend: 1,
    });
    expect(d.fire).toBe(true);
    expect(d.reason).toBe('arrived');
    expect(d.available).toEqual(['legal_vesting', 'grant_deed']);
    expect(d.neverCame).toEqual([]);
  });

  it('never fires for a confirmation that carried everything', () => {
    const d = decideOutstandingAlert({
      missingAtSend: [],
      presentNow: ALL,
      minutesSinceSend: 10_000,
    });
    expect(d.fire).toBe(false);
  });

  it('waits for the last promised document rather than sending two alerts', () => {
    // Legal vesting landed, tax has not. One alert per order is deliberate:
    // two alerts for one file is how a person learns to skim them.
    const d = decideOutstandingAlert({
      missingAtSend: ['legal_vesting', 'tax'],
      presentNow: ['legal_vesting'],
      minutesSinceSend: 5,
    });
    expect(d.fire).toBe(false);
  });
});

describe('the fallback — the case that used to stay silent forever', () => {
  it('reports a promised document that never came', () => {
    const d = decideOutstandingAlert({
      missingAtSend: ['legal_vesting', 'tax'],
      presentNow: [],
      minutesSinceSend: OUTSTANDING_ALERT_FALLBACK_MINUTES,
    });
    expect(d.fire).toBe(true);
    expect(d.reason).toBe('never_arrived');
    expect(d.neverCame).toEqual(['legal_vesting', 'tax']);
  });

  it('reports what did arrive alongside what never did', () => {
    const d = decideOutstandingAlert({
      missingAtSend: ALL,
      presentNow: ['grant_deed'],
      minutesSinceSend: OUTSTANDING_ALERT_FALLBACK_MINUTES + 1,
    });
    expect(d.reason).toBe('never_arrived');
    expect(d.available).toEqual(['grant_deed']);
    expect(d.neverCame).toEqual(['legal_vesting', 'tax']);
  });

  it('does NOT claim a grant deed never came', () => {
    /*
      THE ONE CASE THAT MUST NOT ALERT.

      A missing grant deed often means no qualifying deed exists — the Legal &
      Vesting found none. Nothing is coming, the customer was promised nothing,
      and there is nothing for a person to do. Alerting here would put a
      recurring non-event in the same inbox as the real failures, which is how
      an alert stops being read.

      This is the distinction CONFIRMATION_OPTIONAL_DOC_TYPES already carries,
      read rather than reinvented.
    */
    const d = decideOutstandingAlert({
      missingAtSend: ['grant_deed'],
      presentNow: ['legal_vesting', 'tax'],
      minutesSinceSend: OUTSTANDING_ALERT_FALLBACK_MINUTES * 10,
    });
    expect(d.fire).toBe(false);
  });

  it('still forwards a grant deed that DOES turn up', () => {
    // The team's original report was grant deeds missing from the email. One
    // that exists is worth sending whether or not it was promised.
    const d = decideOutstandingAlert({
      missingAtSend: ['grant_deed'],
      presentNow: ALL,
      minutesSinceSend: 2,
    });
    expect(d.fire).toBe(true);
    expect(d.reason).toBe('arrived');
    expect(d.available).toEqual(['grant_deed']);
  });
});

describe('missingFromConfirmation', () => {
  it('is the confirmation categories minus what attached', () => {
    expect(missingFromConfirmation(['tax'])).toEqual(['legal_vesting', 'grant_deed']);
    expect(missingFromConfirmation(ALL)).toEqual([]);
  });

  it('ignores categories the confirmation never carries', () => {
    expect(missingFromConfirmation(['cpl', 'prelim'])).toEqual(ALL);
  });
});

describe('the email a person acts on', () => {
  const base = {
    orderId: 8523,
    fileNumber: '20021993-GLT',
    address: '1234 Goldenhorn Drive, Corona, CA 92883',
    clientName: 'Dana Reyes',
    clientEmail: 'dana@example.com',
    sentAt: new Date('2026-09-09T15:53:31Z'),
  };

  it('carries everything needed to forward without opening another screen', () => {
    const { subject, html } = buildOutstandingAlertEmail({
      ...base,
      decision: {
        fire: true, reason: 'arrived',
        available: ['legal_vesting', 'grant_deed'], neverCame: [],
      },
    });

    expect(subject).toContain('20021993-GLT');
    expect(subject).toContain('Legal and Vesting');

    expect(html).toContain('Dana Reyes');
    expect(html).toContain('mailto:dana@example.com');
    expect(html).toContain('Goldenhorn');
    expect(html).toContain('Legal and Vesting');
    expect(html).toContain('Recent Grant Deed');
    expect(html).toContain('/orders/8523');
  });

  it('says plainly when there is no client to send to', () => {
    // An order with no client contact is not an order to skip — someone still
    // has to work out who this goes to, and a blank field would not say so.
    const { html } = buildOutstandingAlertEmail({
      ...base, clientName: null, clientEmail: null,
      decision: { fire: true, reason: 'arrived', available: ['tax'], neverCame: [] },
    });
    expect(html).toContain('No client email on this order');
    expect(html).not.toContain('mailto:null');
  });

  it('reads as a problem, not a forwarding task, when nothing arrived', () => {
    const { subject, html } = buildOutstandingAlertEmail({
      ...base,
      decision: {
        fire: true, reason: 'never_arrived',
        available: [], neverCame: ['legal_vesting'],
      },
    });
    expect(subject).toContain('never arrived');
    expect(html).toContain('needs looking at');
  });

  it('escapes a property address that contains markup', () => {
    const { html } = buildOutstandingAlertEmail({
      ...base, address: '<script>alert(1)</script>',
      decision: { fire: true, reason: 'arrived', available: ['tax'], neverCame: [] },
    });
    expect(html).not.toContain('<script>');
  });
});

describe('wiring', () => {
  const root = join(__dirname, '..', '..', '..', '..');

  it('the slug, the migration and the dispatch event type are one string', () => {
    // mapEventToSlug falls through to the event type, so a mismatch here does
    // not throw — it resolves no recipients and sends nothing, silently.
    const migration = readFileSync(
      join(root, 'src/lib/db/migrations/0046_outstanding_documents_alert.sql'), 'utf8',
    );
    expect(OUTSTANDING_ALERT_EVENT_TYPE).toBe('order.documents.outstanding');
    expect(migration).toContain(`'${OUTSTANDING_ALERT_EVENT_TYPE}'`);
    expect(migration).toContain("'{internal}'");
    expect(migration).toContain('openorders@pct.com');
  });

  it('is registered as a job and scheduled as a cron', () => {
    const route = readFileSync(join(root, 'src/app/api/jobs/run/route.ts'), 'utf8');
    const vercel = readFileSync(join(root, 'vercel.json'), 'utf8');
    expect(route).toContain("'notifications.outstanding_documents_alert'");
    expect(vercel).toContain('name=notifications.outstanding_documents_alert');
  });

  it('the scanner refuses to guess when the send was never recorded', () => {
    // Confirmations sent before metadata capture cannot be alerted on, and
    // inferring from document timestamps is the exact inference that cannot
    // tell "never generated" from "generated and dropped".
    const scanner = readFileSync(
      join(root, 'src/lib/jobs/handlers/outstanding-documents-alert.ts'), 'utf8',
    );
    expect(scanner).toContain('skippedNoMetadata');
    expect(scanner).toMatch(/if \(!meta\) \{[\s\S]*?continue;/);
  });

  it('unalertable rows cannot starve the batch', () => {
    /*
      At cutover a 24-hour window held hundreds of confirmations with no send
      record, none of which can ever produce an alert. Without filtering them
      at the source, a run takes 25 rows that can only be skipped and a genuine
      alert waits a day behind them. Newest-first is the same concern from the
      other end — this alert's value decays.
    */
    const scanner = readFileSync(
      join(root, 'src/lib/jobs/handlers/outstanding-documents-alert.ts'), 'utf8',
    );
    expect(scanner).toContain('isNotNull(notificationLogs.metadata)');
    expect(scanner).toContain('desc(min(notificationLogs.sentAt))');
  });

  it('the two aggregates are aliased apart', () => {
    /*
      Both render as bare `min(...)`, so Postgres returns two columns named
      "min" and the second silently overwrites the first in a name-keyed row —
      the send time would arrive holding the metadata text, every order would
      look freshly sent, and the fallback would never fire.

      Caught by executing the generated SQL rather than reading it, which is
      the only way this one was ever going to show up.
    */
    const scanner = readFileSync(
      join(root, 'src/lib/jobs/handlers/outstanding-documents-alert.ts'), 'utf8',
    );
    expect(scanner).toContain(`.as('first_sent_at')`);
    expect(scanner).toContain(`.as('send_record')`);
  });
});
