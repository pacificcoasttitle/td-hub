import { describe, expect, it, vi, afterEach } from 'vitest';
import { createOrUpdateOrder } from './payloads';
import type { CplOrderDetail, CplGenerateInput } from '../types';

// ─── A partial create must not throw the tvid away ──────────────────────────
//
// Westcor answers 200 with BOTH `tvid` and `messages.error` when it creates the
// order and then rejects something inside it. Orders 48, 49 and 6142 were
// stranded because we threw on the error and discarded the tvid in the same
// object, so every retry issued a CREATE that Westcor refused as a duplicate.

const cfg = { baseUrl: 'https://westcor.test/', integrationPartner: '9999', username: '', password: '' };
const branch = { branchCode: 'CA1038', agencyName: 'PCT', address: '1 A St', city: 'Orange', state: 'CA', zip: '92867' };

const detail = {
  fileNumber: '20020090-GLT', transactionType: 'Purchase',
  property: { address: '1 Main St', city: 'Orange', state: 'CA', zip: '92867', county: 'Orange' },
  lender: { name: 'Provident CU', address: null, city: null, state: null, zip: null },
  buyers: ['A Buyer'], sellers: ['A Seller'], salesPrice: '1000000', loanAmount: null,
} as unknown as CplOrderDetail;
const input = { orderId: 6142, underwriter: 'westcor', branchId: 1 } as unknown as CplGenerateInput;

const respond = (body: unknown) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })));
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('a partial Step A carries its tvid out on the error', () => {
  it('the exact 6142 shape: order created, seller rejected', async () => {
    respond({
      tvid: 357051,
      messages: { error: ['Seller #2: Not Added. Please provide at least a Company Name and/or First and Last Name of the individual.'], success: [], warning: [] },
    });

    const err = await createOrUpdateOrder(cfg, 't', detail, input, branch, null)
      .then(() => null, (e) => e as Error & { westcorTvid?: string; diagnostics?: Record<string, unknown> });

    expect(err).not.toBeNull();
    expect(err!.message).toContain('Seller #2');
    // The whole point: the order Westcor just made is recoverable.
    expect(err!.westcorTvid).toBe('357051');
    expect(err!.diagnostics?.partialCreateTvid).toBe('357051');
  });

  it('no tvid attached when Westcor assigned none', async () => {
    respond({ tvid: 0, messages: { error: ['Property #1: Street address is a required field!'], success: [], warning: [] } });
    const err = await createOrUpdateOrder(cfg, 't', detail, input, branch, null)
      .then(() => null, (e) => e as Error & { westcorTvid?: string });
    // Nothing was created, so there is nothing to recover and nothing to store.
    expect(err!.westcorTvid).toBeUndefined();
  });

  it('a clean create still returns normally', async () => {
    respond({ tvid: 357052, messages: { error: [], success: ['File Created successfully!'], warning: [] }, lenders: [{ Id: 81 }] });
    const r = await createOrUpdateOrder(cfg, 't', detail, input, branch, null);
    expect(r.westcorOrderId).toBe('357052');
  });
});
