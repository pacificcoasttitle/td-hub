import { describe, expect, it } from 'vitest';
import {
  changedFormKeys,
  protectConfirmedPartyFields,
  submissionSnapshot,
} from './party-confirmation';

// ─── The latch ───────────────────────────────────────────────────────────────
//
// These tests are the invariant. A confirmed value must survive the writers
// that have been quietly replacing better data all week. The cases are the
// ones Gerard named: confirm name + newly collected email; change a prefilled
// name; leave a prefilled name untouched and submit.

const CONFIRMED = { partyConfirmedAt: new Date('2026-08-31T17:00:00Z') };

describe('protectConfirmedPartyFields', () => {
  it('lets a parser write everything when the row is not confirmed', () => {
    const proposed = {
      externalName: 'SoftPro Name',
      externalEmail: 'sp@example.com',
      externalPhone: '555-0100',
      externalCompany: 'SoftPro Realty',
    };
    expect(protectConfirmedPartyFields(
      { partyConfirmedAt: null, externalName: 'Jane' },
      proposed,
    )).toEqual(proposed);
  });

  it('lets a parser write everything when there is no existing row', () => {
    const proposed = { externalName: 'SoftPro Name' };
    expect(protectConfirmedPartyFields(null, proposed)).toEqual(proposed);
    expect(protectConfirmedPartyFields(undefined, proposed)).toEqual(proposed);
  });

  it('freezes a confirmed name against a later SoftPro name, and keeps a newly collected email fillable only if empty', () => {
    // Confirmed name on file; email was collected in the same submit so it is
    // also populated — SoftPro must clobber neither.
    const existing = {
      ...CONFIRMED,
      externalName: 'Jane Smith',
      externalEmail: 'jane@coastrealty.com',
      externalPhone: null,
      externalCompany: null,
    };
    expect(protectConfirmedPartyFields(existing, {
      externalName: 'J SMITH FROM SOFTPRO',
      externalEmail: 'other@softpro.example',
      externalPhone: '555-9999',
      externalCompany: 'Vendor Brokerage',
    })).toEqual({
      externalPhone: '555-9999',
      externalCompany: 'Vendor Brokerage',
    });
  });

  it('treats a prefilled name they left untouched as confirmed — parsers cannot replace it', () => {
    const existing = {
      ...CONFIRMED,
      externalName: 'Jane Smith',
      externalEmail: null,
    };
    expect(protectConfirmedPartyFields(existing, {
      externalName: 'Jane S.',
      externalEmail: 'found@softpro.example',
    })).toEqual({
      externalEmail: 'found@softpro.example',
    });
  });

  it('treats a name they changed on the form as the confirmed value forever', () => {
    const existing = {
      ...CONFIRMED,
      externalName: 'Jane Doe',
      externalEmail: 'jane@coastrealty.com',
    };
    expect(protectConfirmedPartyFields(existing, {
      externalName: 'Jane Smith',
      externalEmail: 'old@softpro.example',
    })).toEqual({});
  });

  it('lets SiteX / lookback fill an empty confirmed-row email without touching the name', () => {
    const existing = {
      ...CONFIRMED,
      externalName: 'Jane Smith',
      externalEmail: null,
      externalPhone: '',
      externalCompany: 'Coast Realty',
    };
    expect(protectConfirmedPartyFields(existing, {
      externalName: 'SITE X OWNER',
      externalEmail: 'found@sitex.example',
      externalPhone: '555-0101',
      externalCompany: 'SiteX Brokerage',
    })).toEqual({
      externalEmail: 'found@sitex.example',
      externalPhone: '555-0101',
    });
  });

  it('drops only the fields that were proposed — unrelated keys are not invented', () => {
    const existing = { ...CONFIRMED, externalName: 'Jane Smith' };
    expect(protectConfirmedPartyFields(existing, { externalName: 'Other' }))
      .toEqual({});
  });
});

describe('submission snapshot', () => {
  const shown = {
    agentName: 'Jane Smith',
    agentEmail: 'jane@coastrealty.com',
    agentPhone: '(555) 555-5555',
    agentCompany: 'Coast Realty',
  };

  it('records an empty changed-keys list when they confirm as shown — still a snapshot', () => {
    const snap = submissionSnapshot(shown, { ...shown });
    expect(snap.prefilledValues).toEqual(shown);
    expect(snap.changedKeys).toEqual([]);
  });

  it('names the keys they edited, including a newly collected email', () => {
    const snap = submissionSnapshot(
      { agentName: 'Jane Smith' },
      { agentName: 'Jane Smith', agentEmail: 'jane@coastrealty.com' },
    );
    expect(snap.changedKeys).toEqual(['agentEmail']);
  });

  it('treats a changed prefilled name as a change, not as the original', () => {
    expect(changedFormKeys(shown, { ...shown, agentName: 'Jane Doe' }))
      .toEqual(['agentName']);
  });

  it('trims before comparing so a matching value with spaces is not a change', () => {
    expect(changedFormKeys(shown, { ...shown, agentName: '  Jane Smith  ' }))
      .toEqual([]);
  });
});
