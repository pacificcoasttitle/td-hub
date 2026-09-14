import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { isUniqueViolation, pgErrorFields } from './pg-error';

/** The shape postgres.js throws — the fields a real 22001 carried on 2026-09-14. */
function postgresError(fields: Record<string, string>): Error {
  return Object.assign(new Error(fields.message ?? 'postgres error'), fields);
}

describe('pgErrorFields', () => {
  it('reads the cause of a DrizzleQueryError, not the wrapper', () => {
    // The wrapper is what the create-order catch receives. Its own message is
    // the statement and its params; the reason is only on cause.
    const wrapped = new DrizzleQueryError(
      'insert into "order_properties" ("property_type") values ($1)',
      ['Retail Stores (Personal Services, Photography, Travel)'],
      postgresError({
        message: 'value too long for type character varying(50)',
        code: '22001',
        routine: 'varchar',
      }),
    );

    // The regression itself: the wrapper has no code.
    expect((wrapped as unknown as { code?: string }).code).toBeUndefined();

    expect(pgErrorFields(wrapped)).toEqual({
      code: '22001',
      constraint: null,
      column: null,
      table: null,
      detail: null,
      message: 'value too long for type character varying(50)',
    });
  });

  it('carries constraint, column, table and detail when Postgres gives them', () => {
    const wrapped = new DrizzleQueryError('insert into "orders" …', [], postgresError({
      message: 'duplicate key value violates unique constraint "orders_file_number_idx"',
      code: '23505',
      constraint_name: 'orders_file_number_idx',
      table_name: 'orders',
      detail: 'Key (file_number)=(20022165-OCT) already exists.',
    }));

    expect(pgErrorFields(wrapped)).toMatchObject({
      code: '23505',
      constraint: 'orders_file_number_idx',
      table: 'orders',
      detail: 'Key (file_number)=(20022165-OCT) already exists.',
    });
  });

  it('reads an unwrapped driver error too', () => {
    expect(pgErrorFields(postgresError({ code: '23503', message: 'fk' })).code).toBe('23503');
  });

  it('returns nulls and the message for something that is not a database error', () => {
    expect(pgErrorFields(new Error('SoftPro timeout'))).toEqual({
      code: null, constraint: null, column: null, table: null, detail: null, message: 'SoftPro timeout',
    });
    expect(pgErrorFields('plain string').message).toBe('plain string');
  });
});

describe('isUniqueViolation', () => {
  it('matches a unique violation Drizzle has wrapped', () => {
    // enrich-orders read err.code off the wrapper, so this was false in production.
    const wrapped = new DrizzleQueryError('insert into "order_parties" …', [], postgresError({ code: '23505' }));
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it('does not match other failures', () => {
    const wrapped = new DrizzleQueryError('insert …', [], postgresError({ code: '22001' }));
    expect(isUniqueViolation(wrapped)).toBe(false);
    expect(isUniqueViolation(new Error('no'))).toBe(false);
  });
});
