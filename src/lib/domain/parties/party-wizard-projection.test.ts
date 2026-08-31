import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── The projection merge rule ───────────────────────────────────────────────
//
// Decided rule: a write updates a field ONLY when the incoming value is
// non-empty, evaluated PER FIELD, not per row. A blank never clobbers, in
// either direction, so wizard and SoftPro data merge instead of taking turns
// overwriting each other.
//
// This is load-bearing: if it regresses, a SoftPro sync that returns a name but
// no email silently erases an email an agent typed in. These tests hold it.

const selectLimitMock = vi.fn();
const updateSetMock = vi.fn();
const insertValuesMock = vi.fn();

vi.mock('@/lib/db/schema', () => ({
  orderParties: { id: 'op.id', orderId: 'op.order_id', role: 'op.role', isPrimary: 'op.is_primary' },
  orderProperties: {}, orders: {}, partySubmissions: {}, partyWizardLinks: {},
}));

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  desc: (a: unknown) => a,
  eq: (...a: unknown[]) => a,
  sql: Object.assign((...a: unknown[]) => a, { raw: (s: string) => s }),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimitMock }) }) }),
    update: () => ({ set: (v: unknown) => { updateSetMock(v); return { where: vi.fn() }; } }),
    insert: () => ({ values: (v: unknown) => { insertValuesMock(v); return { returning: vi.fn() }; } }),
  },
}));

vi.mock('@/lib/integrations/softpro', () => ({ addNotes: vi.fn() }));

import { projectToOrderParties } from './party-wizard-service';

const FULL = {
  submittedName: 'Jane Smith',
  submittedCompany: 'Coast Realty',
  submittedEmail: 'jane@brokerage.com',
  submittedPhone: '5625550101',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('projecting a submission onto order_parties', () => {
  describe('when no row exists yet', () => {
    beforeEach(() => selectLimitMock.mockResolvedValue([]));

    it('inserts, tagged as wizard-sourced', async () => {
      await projectToOrderParties(1, 'listing_agent', FULL);
      expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
        orderId: 1,
        role: 'listing_agent',
        isPrimary: true,
        source: 'party_wizard',
        externalName: 'Jane Smith',
        externalEmail: 'jane@brokerage.com',
      }));
    });

    it('omits empty fields from the insert instead of writing nulls over nothing', async () => {
      await projectToOrderParties(1, 'listing_agent', { ...FULL, submittedCompany: null, submittedPhone: null });
      const payload = insertValuesMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('externalCompany');
      expect(payload).not.toHaveProperty('externalPhone');
      expect(payload.externalName).toBe('Jane Smith');
    });
  });

  describe('when a row already exists', () => {
    beforeEach(() => selectLimitMock.mockResolvedValue([{ id: 99 }]));

    it('updates rather than inserting a duplicate', async () => {
      await projectToOrderParties(1, 'listing_agent', FULL);
      expect(updateSetMock).toHaveBeenCalledOnce();
      expect(insertValuesMock).not.toHaveBeenCalled();
    });

    it('SETS ONLY the non-empty fields — a blank cannot clobber', async () => {
      await projectToOrderParties(1, 'listing_agent', {
        submittedName: 'Jane Smith',
        submittedCompany: null,
        submittedEmail: null,
        submittedPhone: null,
      });
      const set = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
      expect(set.externalName).toBe('Jane Smith');
      expect(set).not.toHaveProperty('externalCompany');
      expect(set).not.toHaveProperty('externalEmail');
      expect(set).not.toHaveProperty('externalPhone');
    });

    it('treats an empty string exactly like a missing value', async () => {
      await projectToOrderParties(1, 'listing_agent', {
        submittedName: 'Jane Smith', submittedCompany: '', submittedEmail: '', submittedPhone: '',
      });
      const set = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.keys(set).sort()).toEqual(['externalName', 'source']);
    });

    it('tags the row as wizard-sourced on update too', async () => {
      await projectToOrderParties(1, 'listing_agent', FULL);
      expect((updateSetMock.mock.calls[0][0] as Record<string, unknown>).source).toBe('party_wizard');
    });
  });

  it('writes nothing at all when every field is empty', async () => {
    selectLimitMock.mockResolvedValue([{ id: 99 }]);
    await projectToOrderParties(1, 'listing_agent', {
      submittedName: null, submittedCompany: null, submittedEmail: null, submittedPhone: null,
    });
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('projects a named seller onto its own role row', async () => {
    selectLimitMock.mockResolvedValue([]);
    await projectToOrderParties(1, 'seller', {
      submittedName: 'Sam Seller', submittedCompany: null,
      submittedEmail: 'sam@example.com', submittedPhone: null,
    });
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      role: 'seller', source: 'party_wizard', externalName: 'Sam Seller',
    }));
  });

  it('latches the row when the wizard confirms — even if values already matched', async () => {
    selectLimitMock.mockResolvedValue([{ id: 99 }]);
    const confirmedAt = new Date('2026-08-31T18:00:00Z');
    await projectToOrderParties(1, 'listing_agent', FULL, {
      submissionId: 44,
      confirmedAt,
    });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      externalName: 'Jane Smith',
      source: 'party_wizard',
      partyConfirmedAt: confirmedAt,
      partyConfirmedSubmissionId: 44,
    }));
  });
});
