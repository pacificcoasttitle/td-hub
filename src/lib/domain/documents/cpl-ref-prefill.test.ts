import { beforeEach, describe, expect, it, vi } from 'vitest';

const { orderByMock, whereMock, insertMock, updateMock, deleteMock } = vi.hoisted(() => ({
  orderByMock: vi.fn(),
  whereMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: (...args: unknown[]) => {
          whereMock(...args);
          return { orderBy: orderByMock };
        },
      })),
    })),
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  },
}));

vi.mock('@/lib/db/schema', () => ({
  orderExternalRefs: {
    id: 'id',
    orderId: 'order_id',
    system: 'system',
    refType: 'ref_type',
    refValue: 'ref_value',
    createdAt: 'created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...a: unknown[]) => ({ op: 'and', a })),
  eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ op: 'inArray', col, vals })),
  desc: vi.fn((col: unknown) => ({ op: 'desc', col })),
}));

import {
  SHARED_CPL_REF_TYPES,
  getCplRefPrefill,
  preferCplRef,
} from './cpl-ref-prefill';

type Row = { refType: string; refValue: string };

function rows(...r: Row[]) {
  orderByMock.mockResolvedValue(r);
}

beforeEach(() => {
  vi.clearAllMocks();
  orderByMock.mockResolvedValue([]);
});

describe('the allowlist', () => {
  it('never carries cpl_branch_id — CPL and PCT branch ids are different id spaces', () => {
    // The trap. Both are integers in a dropdown, so a Westcor branch id landing
    // in a PCT selector looks entirely normal. Guarded at the query, so the
    // value is never even fetched.
    expect(SHARED_CPL_REF_TYPES).not.toContain('cpl_branch_id');
  });

  it('never carries cpl_lender_contact — Proposed Insured has no such field', () => {
    expect(SHARED_CPL_REF_TYPES).not.toContain('cpl_lender_contact');
  });

  it('is an explicit list, not a cpl_ prefix match', async () => {
    // A LIKE 'cpl_%' would pick up branch id, lender contact, and anything
    // added to cpl/service.ts later, silently. This asserts the query asks
    // for named types.
    await getCplRefPrefill(1);
    const { inArray } = await import('drizzle-orm');
    expect(inArray).toHaveBeenCalledWith('ref_type', [...SHARED_CPL_REF_TYPES]);
    expect(SHARED_CPL_REF_TYPES).toEqual([
      'cpl_lender_address',
      'cpl_lender_city',
      'cpl_lender_state',
      'cpl_lender_zip',
      'cpl_assignment_clause',
      'cpl_loan_number',
    ]);
  });

  it('drops a disallowed ref_type even if the query returns one', async () => {
    // Belt and braces: the allowlist is enforced on the way out too, so a
    // hand-written query or a changed predicate cannot leak the branch id.
    rows(
      { refType: 'cpl_branch_id', refValue: '20' },
      { refType: 'cpl_lender_contact', refValue: 'Jane at the lender' },
      { refType: 'cpl_lender_city', refValue: 'Encino' },
    );
    const prefill = await getCplRefPrefill(7387);
    expect(prefill).toEqual({ lenderCity: 'Encino' });
    expect(JSON.stringify(prefill)).not.toContain('20');
  });
});

describe('underwriter scope', () => {
  it('does not filter by system, so Westcor refs prefill after a switch to FNF', async () => {
    // order_external_refs.system is the underwriter; Proposed Insured has no
    // underwriter. Filtering is what created the FNF/Westcor gap.
    await getCplRefPrefill(7387);
    const { eq } = await import('drizzle-orm');
    const columns = vi.mocked(eq).mock.calls.map(([col]) => col);
    expect(columns).toEqual(['order_id']);
    expect(columns).not.toContain('system');
  });

  it('reads refs written by either underwriter on the same order', async () => {
    rows(
      { refType: 'cpl_loan_number', refValue: '2026080140' },
      { refType: 'cpl_lender_address', refValue: '16000 Ventura Boulevard, Suite 305' },
    );
    expect(await getCplRefPrefill(7387)).toEqual({
      loanNumber: '2026080140',
      lenderAddress: '16000 Ventura Boulevard, Suite 305',
    });
  });
});

describe('precedence', () => {
  it('takes the first row per ref_type, the query having ordered them', async () => {
    rows(
      { refType: 'cpl_lender_city', refValue: 'Encino' },
      { refType: 'cpl_lender_city', refValue: 'Sherman Oaks' },
    );
    expect((await getCplRefPrefill(7387)).lenderCity).toBe('Encino');
  });

  it('orders most recent first, breaking ties on id', async () => {
    await getCplRefPrefill(1);
    const { desc } = await import('drizzle-orm');
    expect(vi.mocked(desc).mock.calls.map(([col]) => col)).toEqual(['created_at', 'id']);
  });

  it('a stored CPL value beats one derived from the company record', () => {
    expect(preferCplRef('16000 Ventura Blvd', '1 Company Default St')).toBe('16000 Ventura Blvd');
  });

  it('an absent or blank ref never blanks the derived value', () => {
    // The failure we do not want: opening PI on an order with no CPL and
    // finding the lender address wiped.
    expect(preferCplRef(undefined, '1 Company Default St')).toBe('1 Company Default St');
    expect(preferCplRef('', '1 Company Default St')).toBe('1 Company Default St');
    expect(preferCplRef('   ', '1 Company Default St')).toBe('1 Company Default St');
  });

  it('skips a blank ref and falls through to the next row for that field', async () => {
    rows(
      { refType: 'cpl_lender_state', refValue: '  ' },
      { refType: 'cpl_lender_state', refValue: 'CA' },
    );
    expect((await getCplRefPrefill(7387)).lenderState).toBe('CA');
  });
});

describe('read-only', () => {
  it('writes nothing back to order_external_refs', async () => {
    // PI consumes CPL input; it is not a second author of it. If it wrote
    // back, drafting a PI would silently change what the next CPL starts from.
    rows({ refType: 'cpl_loan_number', refValue: '2026080140' });
    await getCplRefPrefill(7387);
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('returns an empty object when the order has no CPL refs', async () => {
    // Refs are written on success only, so this is also what a failed CPL
    // looks like. Empty, not an error.
    expect(await getCplRefPrefill(999)).toEqual({});
  });
});
