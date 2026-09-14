import { describe, expect, it } from 'vitest';
import { buildCreateFailureAlertEmail, CREATE_FAILURE_ALERT_EVENT_TYPE, explainCreateFailure } from './create-failure';

describe('explainCreateFailure', () => {
  it('names an overflow and where it happened', () => {
    expect(explainCreateFailure({
      code: '22001',
      message: 'value too long for type character varying(50)',
      failedStatement: 'insert into order_properties',
    })).toBe('A value was longer than its column allows (value too long for type character varying(50)) during insert into order_properties.');
  });

  it('says the sync got there first for a duplicate file number', () => {
    expect(explainCreateFailure({ code: '23505', constraint: 'orders_file_number_idx' }))
      .toMatch(/SoftPro sync imported this file before the hub create finished/);
  });

  it('does not guess for a failure recorded before the recorder read the cause', () => {
    // All ten rows from 2026-09-09 to 2026-09-14 look like this.
    expect(explainCreateFailure({ code: null, stage: 'order_properties' }))
      .toBe('The reason was not recorded (the failure predates the recorder fix) — it failed during the order_properties write.');
  });

  it('falls back to the driver message for a code it has no sentence for', () => {
    expect(explainCreateFailure({ code: '40001', message: 'could not serialize access', failedStatement: 'insert into order_parties' }))
      .toBe('Postgres 40001: could not serialize access during insert into order_parties.');
  });
});

describe('buildCreateFailureAlertEmail', () => {
  const email = buildCreateFailureAlertEmail({
    orderId: 8687,
    fileNumber: '20022166-GLT',
    address: '1222 N Coast Highway 101, Encinitas, CA, 92024',
    failure: { code: '22001', message: 'value too long for type character varying(50)', failedStatement: 'insert into order_properties' },
    operatorEmail: 'operator@example.com',
    failedAt: new Date('2026-09-15T00:04:19Z'),
  });

  it('names the file in the subject', () => {
    expect(email.subject).toBe('Hub order did not finish saving — 20022166-GLT');
  });

  it('tells the reader not to re-enter, and what to press instead', () => {
    expect(email.html).toContain('Do not re-enter it');
    expect(email.html).toContain('Finish saving');
  });

  it('links to the hub by FILE NUMBER, which is what ?order= takes', () => {
    expect(email.html).toContain('/hub?order=20022166-GLT');
    expect(email.html).not.toContain('/hub?order=8687');
  });

  it('carries the recorded reason', () => {
    expect(email.html).toContain('22001');
    expect(email.html).toContain('insert into order_properties');
  });

  it('uses the slug migration 0048 seeds', () => {
    expect(CREATE_FAILURE_ALERT_EVENT_TYPE).toBe('order.create.local_failed');
  });
});
