import { describe, expect, it, vi, afterEach } from 'vitest';
import { createOrUpdateOrder } from './payloads';
import type { CplOrderDetail, CplGenerateInput } from '../types';

// ─── The non-200 branch must keep the body, like the 200 branch does ────────
//
// dd3ac9f fixed the 200-with-messages.error path. This is the branch one over:
// the one that emitted "Agent Number - Order Number Must be Unique" and kept
// nothing but 300 characters of it inside an exception message.

const cfg = { baseUrl: 'https://westcor.test/', integrationPartner: '7758' };
const branch = { branchCode: 'CA1038', agencyName: 'PCT', address: '1 A St', city: 'Orange', state: 'CA', zip: '92867' };
const detail = {
  fileNumber: '20020090-GLT', transactionType: 'Purchase',
  property: { address: '1 Main St', city: 'Orange', state: 'CA', zip: '92867', county: 'Orange' },
  lender: { name: 'Provident CU', address: null, city: null, state: null, zip: null },
  buyers: ['A Buyer'], sellers: ['A Seller'], salesPrice: '1000000', loanAmount: null,
} as unknown as CplOrderDetail;
const input = { orderId: 6142, underwriter: 'westcor', branchId: 1 } as unknown as CplGenerateInput;

const respond = (body: string, status: number) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));
};
const attempt = () => createOrUpdateOrder(cfg, 't', detail, input, branch, null)
  .then(() => null, (e) => e as Error & { diagnostics?: Record<string, unknown>; westcorTvid?: string });

afterEach(() => { vi.unstubAllGlobals(); });

describe('a Westcor 500 no longer throws its body away', () => {
  it('keeps the whole body, not 300 characters of it', async () => {
    const body = 'Exception Errors Occurred: Agent Number - Order Number Must be Unique. | '
      + 'STACK: '.repeat(200);
    respond(body, 500);
    const err = await attempt();
    expect(err!.diagnostics!.rawResponse).toBe(body);
    expect(err!.diagnostics!.rawResponseBytes).toBe(body.length);
    expect(err!.diagnostics!.rawResponseTruncated).toBe(false);
    // The message stays short and readable; the body is what got longer.
    expect(err!.message).toContain('Must be Unique');
  });

  it('IF a 500 carries a tvid, the order stays recoverable', async () => {
    // Whether Westcor does this is unknown — nobody kept a body to look at.
    // That is the point: if it does, we now catch it instead of stranding.
    respond(JSON.stringify({ tvid: 4145864, messages: { error: ['Order Number Must be Unique'] } }), 500);
    const err = await attempt();
    expect(err!.westcorTvid).toBe('4145864');
    expect(err!.diagnostics!.partialCreateTvid).toBe('4145864');
  });

  it('invents nothing when there is no tvid', async () => {
    for (const body of ['plain text fault', '', '{"tvid":0}', '{"tvid":null}', 'not json {']) {
      respond(body, 500);
      const err = await attempt();
      expect(err!.westcorTvid, JSON.stringify(body)).toBeUndefined();
      expect(err!.diagnostics!.rawResponse, JSON.stringify(body)).toBe(body);
    }
  });

  it('a tvid in an array body is found too', async () => {
    respond(JSON.stringify([{ tvid: 3692238 }]), 500);
    expect((await attempt())!.westcorTvid).toBe('3692238');
  });

  it('a huge body is capped, and says so', async () => {
    const body = 'x'.repeat(70_000);
    respond(body, 500);
    const err = await attempt();
    expect(String(err!.diagnostics!.rawResponse).length).toBe(64_000);
    expect(err!.diagnostics!.rawResponseTruncated).toBe(true);
    expect(err!.diagnostics!.rawResponseBytes).toBe(70_000);
  });

  it('the http status rides along', async () => {
    respond('boom', 503);
    expect((await attempt())!.diagnostics!.httpStatus).toBe(503);
  });
});
