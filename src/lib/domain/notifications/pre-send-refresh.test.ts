import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/db/schema', () => ({ adminActivityLogs: {}, eventOutbox: {}, orderContactDrift: {} }));

import type { MappedOrderContacts, MappedResolvedParty } from '@/lib/integrations/softpro';
import {
  buildContactDriftAlertEmail,
  decideRecipient,
  PRE_SEND_TIMEOUT_MS,
  refreshBeforeSend,
  type PreSendDecision,
} from './pre-send-refresh';

function party(overrides: Partial<MappedResolvedParty> = {}): MappedResolvedParty {
  return {
    name: null, email: null, phone: null, lookupCode: null,
    companyName: null, companyLookupCode: null, companyEmail: null, companyPhone: null,
    ...overrides,
  };
}

function contacts(parties: Partial<MappedOrderContacts['parties']>): MappedOrderContacts {
  return {
    parties: {
      buyer: null, secondaryBuyer: null, seller: null, secondarySeller: null,
      escrowCompany: null, lender: null, listingAgent: null, buyerAgent: null,
      mortgageBroker: null, payoffLender: null, titleCompany: null, underwriter: null,
      ...parties,
    },
  } as MappedOrderContacts;
}

const INLAND = party({ name: 'Kim Hoh', email: 'kim@inlandempireescrow.com', companyName: 'Inland Empire Escrow', companyEmail: 'escrow@inlandempireescrow.com' });

describe('decideRecipient — the rule', () => {
  it('agrees when our address is SoftPro\'s person email (case and spaces ignored)', () => {
    const d = decideRecipient({ role: 'escrow', email: ' KIM@InlandEmpireEscrow.com ', name: 'Kim' }, contacts({ escrowCompany: INLAND }));
    expect(d).toEqual({ role: 'escrow', status: 'agrees', email: 'kim@inlandempireescrow.com', name: 'Kim' });
  });

  it('agrees when our address is the same firm\'s company inbox — not a disagreement', () => {
    const d = decideRecipient({ role: 'escrow', email: 'escrow@inlandempireescrow.com', name: null }, contacts({ escrowCompany: INLAND }));
    expect(d.status).toBe('agrees');
  });

  it('DIFFERS: sends to SoftPro\'s person, and keeps ours for the record', () => {
    // 20018662-GLT on 2026-09-16: we held Premier Properties Escrow, SoftPro Inland Empire.
    const d = decideRecipient({ role: 'escrow', email: 'm@premierpropertiesescrow.com', name: 'M' }, contacts({ escrowCompany: INLAND }));
    expect(d).toEqual({
      role: 'escrow', status: 'differs', email: 'kim@inlandempireescrow.com', name: 'Kim Hoh',
      ours: 'm@premierpropertiesescrow.com',
    });
  });

  it('DIFFERS falls back to SoftPro\'s company email when the person has none', () => {
    const d = decideRecipient(
      { role: 'lender', email: 'old@lender.com', name: null },
      contacts({ lender: party({ companyName: 'New Lender', companyEmail: 'closing@newlender.com' }) }),
    );
    expect(d).toMatchObject({ status: 'differs', email: 'closing@newlender.com', name: 'New Lender' });
  });

  it('SOFTPRO HAS NONE: does not substitute ours', () => {
    const d = decideRecipient({ role: 'escrow', email: 'ours@escrow.com', name: null }, contacts({ escrowCompany: party({ name: 'No Email' }) }));
    expect(d).toEqual({ role: 'escrow', status: 'softpro_has_none', ours: 'ours@escrow.com' });
  });

  it('treats a malformed SoftPro address as none, not as an address to send to', () => {
    const d = decideRecipient({ role: 'escrow', email: 'ours@escrow.com', name: null }, contacts({ escrowCompany: party({ email: 'theforeclosureco.gmail.com' }) }));
    expect(d.status).toBe('softpro_has_none');
  });

  it('maps owner to SoftPro\'s buyer', () => {
    const d = decideRecipient({ role: 'owner', email: null, name: null }, contacts({ buyer: party({ name: 'Ana', email: 'ana@buyer.com' }) }));
    expect(d).toMatchObject({ status: 'differs', email: 'ana@buyer.com', ours: null });
  });
});

describe('refreshBeforeSend', () => {
  const input = {
    orderId: 8542, fileNumber: '20018662-GLT', sendKind: 'prelim' as const,
    candidates: [{ role: 'escrow' as const, email: 'm@premierpropertiesescrow.com', name: 'M' }],
  };
  const softproData = {
    EscrowCompanies: {
      Person: { Name: 'Kim Hoh', Email: 'kim@inlandempireescrow.com', LookupCode: 'KimHohInla' },
      Company: { Name: 'Inland Empire Escrow', LookupCode: 'Inlan1279' },
    },
  };

  it('makes ONE call with the pre-send timeout, and records the decisions', async () => {
    const fetchContacts = vi.fn(async () => ({ success: true, data: softproData }));
    const record = vi.fn(async () => undefined);

    const decisions = await refreshBeforeSend(input, { fetchContacts: fetchContacts as never, record });

    expect(fetchContacts).toHaveBeenCalledTimes(1);
    expect(fetchContacts).toHaveBeenCalledWith('20018662-GLT', { timeoutMs: PRE_SEND_TIMEOUT_MS });
    expect(decisions[0]).toMatchObject({ status: 'differs', email: 'kim@inlandempireescrow.com' });
    expect(record).toHaveBeenCalledWith(input, decisions);
  });

  it('retries once, and uses the second answer', async () => {
    const fetchContacts = vi.fn()
      .mockResolvedValueOnce({ success: false, error: { message: 'The operation was aborted due to timeout' } })
      .mockResolvedValueOnce({ success: true, data: softproData });

    const decisions = await refreshBeforeSend(input, { fetchContacts, record: vi.fn() });

    expect(fetchContacts).toHaveBeenCalledTimes(2);
    expect(decisions[0]!.status).toBe('differs');
  });

  it('UNREACHABLE after the retry: sends to ours, and says why', async () => {
    const fetchContacts = vi.fn()
      .mockResolvedValueOnce({ success: false, error: { message: 'timeout' } })
      .mockRejectedValueOnce(new Error('fetch failed'));

    const decisions = await refreshBeforeSend(input, { fetchContacts, record: vi.fn() });

    expect(fetchContacts).toHaveBeenCalledTimes(2);
    expect(decisions[0]).toEqual({
      role: 'escrow', status: 'unreachable', email: 'm@premierpropertiesescrow.com', name: 'M', error: 'fetch failed',
    });
  });

  it('never lets a recording failure stop the send', async () => {
    const fetchContacts = vi.fn(async () => ({ success: true, data: softproData }));
    const record = vi.fn(async () => { throw new Error('db down'); });

    await expect(refreshBeforeSend(input, { fetchContacts: fetchContacts as never, record })).resolves.toHaveLength(1);
  });
});

describe('the drift alert', () => {
  it('says the document went to SoftPro\'s contact, and that the hub was not changed', () => {
    const decisions: PreSendDecision[] = [{
      role: 'escrow', status: 'differs', email: 'kim@inlandempireescrow.com', name: 'Kim', ours: 'm@premierpropertiesescrow.com',
    }];
    const { subject, html } = buildContactDriftAlertEmail({ orderId: 1, fileNumber: '20018662-GLT', sendKind: 'prelim', decisions });
    expect(subject).toBe("Preliminary report sent to SoftPro's contact, not ours — 20018662-GLT");
    expect(html).toContain('m@premierpropertiesescrow.com');
    expect(html).toContain('kim@inlandempireescrow.com');
    expect(html).toContain('Nothing in the hub was changed');
  });

  it('says NOT SENT when SoftPro has no recipient', () => {
    const { subject, html } = buildContactDriftAlertEmail({
      orderId: 1, fileNumber: '20018662-GLT', sendKind: 'lender_policy',
      decisions: [{ role: 'lender', status: 'softpro_has_none', ours: 'ours@lender.com' }],
    });
    expect(subject).toContain('not sent');
    expect(html).toContain('Our address was not used in its place');
  });
});
