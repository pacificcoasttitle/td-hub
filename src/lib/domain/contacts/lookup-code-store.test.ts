import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbRows } = vi.hoisted(() => ({ dbRows: [] as Record<string, unknown>[] }));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => dbRows.slice()),
      })),
    })),
  },
}));

import { findSamePersonInCodeFamily, sendWithUniqueLookupCode } from './lookup-code-store';

describe('sendWithUniqueLookupCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRows.length = 0;
  });

  // THE ROOT OF ERIKA VALENCIA, 2026-09-10. SoftPro held EriValEscr; the hub did
  // not. The suffix policy minted EriValEscr1 and then EriValEscr2 — two
  // permanent SoftPro records for one person. People now refuse.
  it('with the refuse policy, stops at the first SoftPro duplicate and never sends a suffixed code', async () => {
    const duplicate = "Cannot insert duplicate key row in object 'dbo.lkup_X' with unique index 'IX_lkup_X_KEY'. The duplicate key value is (EriValEscr).\r\n";
    const send = vi.fn().mockResolvedValue({ success: false, error: { message: duplicate } });

    const result = await sendWithUniqueLookupCode('EriValEscr', send, { onVendorCollision: 'refuse' });

    expect(result).toMatchObject({ ok: false, collision: true, existsInSoftPro: 'EriValEscr' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe('EriValEscr');
  });

  it('on a SoftPro duplicate, retries with the next suffix in the same request', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ success: false, error: { message: 'LookupCode already exists' } })
      .mockResolvedValueOnce({ success: true });

    const result = await sendWithUniqueLookupCode('Well123M', send);

    expect(result).toEqual({ ok: true, lookupCode: 'Well123M1' });
    expect(send.mock.calls.map((c) => c[0])).toEqual(['Well123M', 'Well123M1']);
  });

  it('treats staging SQL unique-index text as a collision and bumps the suffix', async () => {
    const staging = "Cannot insert duplicate key row in object 'dbo.lkup_X' with unique index 'IX_lkup_X_KEY'. The duplicate key value is (PctHhxqq).\r\n";
    const send = vi.fn()
      .mockResolvedValueOnce({ success: false, error: { message: staging } })
      .mockResolvedValueOnce({ success: true });

    const result = await sendWithUniqueLookupCode('PctHhxqq', send);

    expect(result).toEqual({ ok: true, lookupCode: 'PctHhxqq1' });
    expect(send.mock.calls.map((c) => c[0])).toEqual(['PctHhxqq', 'PctHhxqq1']);
  });

  it('does not retry a non-collision SoftPro error — same code is not resubmitted', async () => {
    const send = vi.fn().mockResolvedValue({ success: false, error: { message: 'UserType is required' } });
    const result = await sendWithUniqueLookupCode('Well123M', send);
    expect(result.ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe('Well123M');
  });
});

describe('findSamePersonInCodeFamily', () => {
  beforeEach(() => {
    dbRows.length = 0;
  });

  const row = (id: number, code: string, email: string) => ({
    id, lookup: code, softpro: code, firstName: 'Sandra', lastName: 'Ruiz', fullName: null,
    email, phone: null, address1: null, city: null, flookupCode: 'Amer1Poi1', companyName: null,
  });

  it('returns the held record whose code SoftPro orders accept, ahead of an eleven-character duplicate', async () => {
    dbRows.push(
      row(23077, 'SanRuiAmer1', 'Sruiz@americanmac.com'),
      row(23076, 'SanRuiAmer', 'Sruiz@americanmac.com'),
    );
    const hit = await findSamePersonInCodeFamily('SanRuiAmer', 'SRUIZ@americanmac.com');
    expect(hit?.id).toBe(23076);
    expect(hit?.lookupCode).toBe('SanRuiAmer');
  });

  it('ignores a same-email row whose code belongs to a different family', async () => {
    dbRows.push(row(9, 'SanRuiBell', 'Sruiz@americanmac.com'));
    expect(await findSamePersonInCodeFamily('SanRuiAmer', 'Sruiz@americanmac.com')).toBeNull();
  });

  it('does not look anything up without an email to compare', async () => {
    dbRows.push(row(23076, 'SanRuiAmer', 'Sruiz@americanmac.com'));
    expect(await findSamePersonInCodeFamily('SanRuiAmer', '  ')).toBeNull();
    expect(await findSamePersonInCodeFamily('SanRuiAmer', null)).toBeNull();
  });
});
