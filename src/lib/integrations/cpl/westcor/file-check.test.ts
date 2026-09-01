import { describe, expect, it, vi, afterEach } from 'vitest';
import { fileCheck } from './payloads';

// ─── Spec 7.1 File Check, measured against production 2026-09-01 ────────────
//
// Every response body below is a real one, copied from the probe run that
// recovered orders 48, 49 and 6142. The spec is wrong about the method, the
// field names and the response shape, so the tests pin the MEASURED contract.

const cfg = { baseUrl: 'https://westcor.test/', integrationPartner: '7758' };

const reply = (body: unknown, status = 200) => {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('fileCheck recovers a tvid Westcor holds and we lost', () => {
  it('order 48, the real response', async () => {
    reply([{ tvid: 3692238, agent_file_number: '20015222-OCT', vendor_transaction_id: null, completed: false, canceled: false }]);
    const r = await fileCheck(cfg, 't', 'CA1038', '20015222-OCT');
    expect(r?.tvid).toBe('3692238');
    expect(r?.canceled).toBe(false);
  });

  it('POSTs, with AN and FileNumber — not the spec\'s GET or snake_case', async () => {
    // Both spec errors in one assertion. A GET answers 400 and the snake_case
    // body answers [] — a SILENT miss, which is the dangerous kind of wrong.
    const spy = reply([{ tvid: 4145864, agent_file_number: '20020090-GLT', canceled: false, completed: false }]);
    await fileCheck(cfg, 'tok', 'CA1038', '20020090-GLT');
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('https://westcor.test/VendorApi/Order/FileCheck/7758');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ AN: 'CA1038', FileNumber: '20020090-GLT' });
  });
});

describe('it fails safe — every miss returns null and changes nothing', () => {
  it('empty array (wrong agent, unknown file, missing AN) is a miss, not an error', async () => {
    reply([]);
    expect(await fileCheck(cfg, 't', 'CA1038', 'ZZ-NOPE')).toBeNull();
  });

  it('more than one row is refused rather than guessed at', async () => {
    // The ambiguity the whole design has to fear: two orders, one file number.
    reply([{ tvid: 1, canceled: false }, { tvid: 2, canceled: false }]);
    expect(await fileCheck(cfg, 't', 'CA1038', '20015222-OCT')).toBeNull();
  });

  it('a non-200 is a miss', async () => {
    reply({ Message: 'The request is invalid.' }, 400);
    expect(await fileCheck(cfg, 't', 'CA1038', '20015222-OCT')).toBeNull();
  });

  it('a zero or absent tvid is a miss', async () => {
    reply([{ tvid: 0, canceled: false }]);
    expect(await fileCheck(cfg, 't', 'CA1038', 'x')).toBeNull();
    reply([{ agent_file_number: 'x' }]);
    expect(await fileCheck(cfg, 't', 'CA1038', 'x')).toBeNull();
  });

  it('a non-array body is a miss', async () => {
    // The spec documents a bare object. If Westcor ever sends one, we do not
    // silently read it as a match.
    reply({ tvid: 3692238, canceled: false });
    expect(await fileCheck(cfg, 't', 'CA1038', 'x')).toBeNull();
  });

  it('no call is made without both fields', async () => {
    const spy = reply([]);
    expect(await fileCheck(cfg, 't', '', '20015222-OCT')).toBeNull();
    expect(await fileCheck(cfg, 't', 'CA1038', '  ')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('a canceled order is reported, so the caller can refuse to revive it', async () => {
    reply([{ tvid: 999, canceled: true, completed: false }]);
    expect((await fileCheck(cfg, 't', 'CA1038', 'x'))?.canceled).toBe(true);
  });
});
