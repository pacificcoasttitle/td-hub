import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  },
}));

import { sendWithUniqueLookupCode } from './lookup-code-store';

describe('sendWithUniqueLookupCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
