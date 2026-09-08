import { describe, expect, it } from 'vitest';
import { resolveLookupUserType, SOFTPRO_LOOKUP_USER_TYPES } from './lookup-types';

describe('resolveLookupUserType', () => {
  it('accepts every spelling SoftPro has answered', () => {
    for (const t of SOFTPRO_LOOKUP_USER_TYPES) expect(resolveLookupUserType(t)).toBe(t);
  });

  it('maps the concatenated spellings that failed 100% of the time', () => {
    // All measured: every one of these returned an error, every call.
    expect(resolveLookupUserType('TitleCompany')).toBe('Title Company');
    expect(resolveLookupUserType('TitleCompanies')).toBe('Title Company');
    expect(resolveLookupUserType('Title Companies')).toBe('Title Company');
    expect(resolveLookupUserType('SellingAgentBroker')).toBe('Selling Agent/Broker');
    expect(resolveLookupUserType('Selling Agent Broker')).toBe('Selling Agent/Broker');
    expect(resolveLookupUserType('EscrowCompany')).toBe('Escrow Company');
  });

  it('is null for a value SoftPro has no spelling for', () => {
    // 'Branch' was tried once and rejected; there is no valid equivalent, so
    // the caller must be told rather than sent to the vendor to find out.
    expect(resolveLookupUserType('Branch')).toBeNull();
    expect(resolveLookupUserType('')).toBeNull();
    expect(resolveLookupUserType(null)).toBeNull();
    expect(resolveLookupUserType('   ')).toBeNull();
  });

  it('is case- and punctuation-insensitive on the aliases', () => {
    expect(resolveLookupUserType('  selling agent/broker ')).toBe('Selling Agent/Broker');
    expect(resolveLookupUserType('sales rep')).toBe('Sales Representative');
  });
});
