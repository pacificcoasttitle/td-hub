import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/db/schema', () => ({
  adminActivityLogs: {},
  contacts: {},
  eventOutbox: {},
  orderContactDrift: {},
  orderParties: {},
}));

import type { MappedOrderContacts, MappedResolvedParty } from '@/lib/integrations/softpro';
import {
  buildContactDriftAlertEmail,
  decideOfficerRecipient,
  decideRecipient,
  detailForFile,
  escrowPreSendSource,
  planSoftProPartyPatch,
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

describe('the field the rule asks depends on order type', () => {
  it('Title-only still asks EscrowCompanies', () => {
    expect(escrowPreSendSource('Title only')).toBe('escrow_company');
    expect(escrowPreSendSource(null)).toBe('escrow_company');
  });

  it('Title & Escrow and Escrow-only ask EscrowOfficerContact', () => {
    expect(escrowPreSendSource('Title & Escrow')).toBe('escrow_officer');
    expect(escrowPreSendSource('Escrow only')).toBe('escrow_officer');
  });
});

describe('decideOfficerRecipient — T&E / Escrow-only', () => {
  const officer = { Name: 'Christine', Email: 'christine@pct.com', LookupCode: 'Chris123' };

  it('agrees when our address is SoftPro\'s officer (case and spaces ignored)', () => {
    const d = decideOfficerRecipient(
      { role: 'escrow', email: ' Christine@PCT.com ', name: 'Christine' },
      officer,
    );
    expect(d).toEqual({ role: 'escrow', status: 'agrees', email: 'christine@pct.com', name: 'Christine' });
  });

  it('DIFFERS: sends to SoftPro\'s officer, and keeps ours for the record', () => {
    const d = decideOfficerRecipient(
      { role: 'escrow', email: 'lupe@pct.com', name: 'Lupe' },
      officer,
    );
    expect(d).toEqual({
      role: 'escrow', status: 'differs', email: 'christine@pct.com', name: 'Christine',
      ours: 'lupe@pct.com',
    });
  });

  it('SOFTPRO HAS NONE: empty officer is a genuine absence and holds the send', () => {
    expect(decideOfficerRecipient(
      { role: 'escrow', email: 'christine@pct.com', name: 'Christine' },
      null,
    )).toEqual({ role: 'escrow', status: 'softpro_has_none', ours: 'christine@pct.com' });
    expect(decideOfficerRecipient(
      { role: 'escrow', email: 'christine@pct.com', name: 'Christine' },
      { Name: 'Christine', Email: '' },
    ).status).toBe('softpro_has_none');
  });

  it('does not fall back to a company inbox — there is not one on these files', () => {
    const src = readFileSync(resolve(__dirname, 'pre-send-refresh.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function decideOfficerRecipient'), src.indexOf('export function detailForFile'));
    expect(fn).not.toContain('companyEmail');
    expect(fn).not.toContain('EscrowCompanies');
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

describe('refreshBeforeSend — Title & Escrow asks EscrowOfficerContact', () => {
  const teInput = {
    orderId: 9101,
    fileNumber: '20022514-OCT',
    sendKind: 'prelim' as const,
    orderType: 'Title & Escrow',
    candidates: [{ role: 'escrow' as const, email: 'christine@pct.com', name: 'Christine' }],
  };
  const details = [{
    OrderNumber: '20022514-OCT',
    EscrowOfficerContact: { Name: 'Christine', Email: 'christine@pct.com', LookupCode: 'Chris123' },
  }];

  it('calls GetOrderDetails once and never GetOrderContacts', async () => {
    const fetchDetails = vi.fn(async () => ({ success: true, data: details }));
    const fetchContacts = vi.fn(async () => {
      throw new Error('GetOrderContacts must not run on a T&E prelim');
    });
    const record = vi.fn(async () => undefined);

    const decisions = await refreshBeforeSend(teInput, {
      fetchContacts: fetchContacts as never,
      fetchDetails: fetchDetails as never,
      record,
    });

    expect(fetchContacts).not.toHaveBeenCalled();
    expect(fetchDetails).toHaveBeenCalledTimes(1);
    expect(fetchDetails).toHaveBeenCalledWith({
      dateFrom: '',
      orderNumber: '20022514-OCT',
      orderId: 9101,
      timeoutMs: PRE_SEND_TIMEOUT_MS,
    });
    expect(decisions[0]).toEqual({
      role: 'escrow', status: 'agrees', email: 'christine@pct.com', name: 'Christine',
    });
    expect(record).toHaveBeenCalledWith(teInput, decisions);
  });

  it('holds the send when EscrowOfficerContact is empty — a genuine absence', async () => {
    const fetchDetails = vi.fn(async () => ({
      success: true,
      data: [{ OrderNumber: '20022514-OCT', EscrowOfficerContact: null }],
    }));

    const decisions = await refreshBeforeSend(teInput, {
      fetchDetails: fetchDetails as never,
      record: vi.fn(),
    });

    expect(decisions[0]).toEqual({
      role: 'escrow', status: 'softpro_has_none', ours: 'christine@pct.com',
    });
  });

  it('Escrow-only uses the same officer field', async () => {
    const fetchDetails = vi.fn(async () => ({ success: true, data: details }));
    const fetchContacts = vi.fn();

    const decisions = await refreshBeforeSend(
      { ...teInput, orderType: 'Escrow only' },
      { fetchContacts: fetchContacts as never, fetchDetails: fetchDetails as never, record: vi.fn() },
    );

    expect(fetchContacts).not.toHaveBeenCalled();
    expect(fetchDetails).toHaveBeenCalledTimes(1);
    expect(decisions[0]!.status).toBe('agrees');
  });

  it('Title-only still calls GetOrderContacts and never GetOrderDetails', async () => {
    const fetchContacts = vi.fn(async () => ({
      success: true,
      data: {
        EscrowCompanies: {
          Person: { Name: 'Kim Hoh', Email: 'kim@inlandempireescrow.com' },
        },
      },
    }));
    const fetchDetails = vi.fn(async () => {
      throw new Error('GetOrderDetails must not run on a Title-only prelim');
    });

    const decisions = await refreshBeforeSend({
      orderId: 8542,
      fileNumber: '20018662-GLT',
      sendKind: 'prelim',
      orderType: 'Title only',
      candidates: [{ role: 'escrow', email: 'm@premierpropertiesescrow.com', name: 'M' }],
    }, { fetchContacts: fetchContacts as never, fetchDetails: fetchDetails as never, record: vi.fn() });

    expect(fetchDetails).not.toHaveBeenCalled();
    expect(fetchContacts).toHaveBeenCalledTimes(1);
    expect(decisions[0]!.status).toBe('differs');
  });

  it('a mixed T&E policy line asks both fields — officer for escrow, contacts for lender', async () => {
    const fetchDetails = vi.fn(async () => ({ success: true, data: details }));
    const fetchContacts = vi.fn(async () => ({
      success: true,
      data: { Lenders: { Company: { Name: 'New Lender', Email: 'closing@newlender.com' } } },
    }));

    const decisions = await refreshBeforeSend({
      orderId: 7,
      fileNumber: '20022514-OCT',
      sendKind: 'lender_policy',
      orderType: 'Title & Escrow',
      candidates: [
        { role: 'escrow', email: 'christine@pct.com', name: 'Christine' },
        { role: 'lender', email: 'loans@oldlender.com', name: 'Old Lender' },
      ],
    }, { fetchContacts: fetchContacts as never, fetchDetails: fetchDetails as never, record: vi.fn() });

    expect(fetchDetails).toHaveBeenCalledTimes(1);
    expect(fetchContacts).toHaveBeenCalledTimes(1);
    expect(decisions[0]).toMatchObject({ role: 'escrow', status: 'agrees' });
    expect(decisions[1]).toMatchObject({ role: 'lender', status: 'differs', email: 'closing@newlender.com' });
  });

  it('picks the matching file out of a GetOrderDetails page', () => {
    expect(detailForFile([
      { OrderNumber: '20000000-OCT', EscrowOfficerContact: { Email: 'other@pct.com' } },
      { OrderNumber: '20022514-OCT', EscrowOfficerContact: { Email: 'christine@pct.com' } },
    ] as never, '20022514-OCT')?.EscrowOfficerContact?.Email).toBe('christine@pct.com');
  });
});

describe('planSoftProPartyPatch — write this order, not the book', () => {
  it('writes SoftPro\'s email and detaches a book contact whose email differs', () => {
    const plan = planSoftProPartyPatch({
      partyConfirmedAt: null,
      externalEmail: 'diana@nexumescrow.com',
      externalName: 'Diana Lopez',
      contactId: 22882,
      bookEmail: 'diana@nexumescrow.com',
    }, 'jessica@nexumescrow.com', 'Jessica');
    expect(plan).toEqual({
      apply: true,
      patch: { externalEmail: 'jessica@nexumescrow.com', externalName: 'Jessica' },
      detachContact: true,
    });
  });

  it('does not detach when the book already holds SoftPro\'s email', () => {
    const plan = planSoftProPartyPatch({
      partyConfirmedAt: null,
      externalEmail: 'old@escrow.com',
      externalName: 'Kim',
      contactId: 9,
      bookEmail: 'kim@inlandempireescrow.com',
    }, 'kim@inlandempireescrow.com', 'Kim Hoh');
    expect(plan.apply).toBe(true);
    expect(plan.detachContact).toBe(false);
  });

  it('will not overwrite a confirmed populated email', () => {
    const plan = planSoftProPartyPatch({
      partyConfirmedAt: new Date('2026-09-01T00:00:00Z'),
      externalEmail: 'typed@escrow.com',
      externalName: 'Typed',
      contactId: 1,
      bookEmail: 'typed@escrow.com',
    }, 'jessica@nexumescrow.com', 'Jessica');
    expect(plan.apply).toBe(false);
  });

  it('the writer updates this order\'s party and never the shared contacts book', () => {
    const src = readFileSync(resolve(__dirname, 'pre-send-refresh.ts'), 'utf8');
    const apply = src.slice(src.indexOf('export async function applySoftProRecipientToOrderParty'));
    expect(apply).toContain('db.update(orderParties)');
    expect(apply).not.toMatch(/db\.update\(\s*contacts\s*\)/);
    expect(apply).not.toMatch(/db\.insert\(\s*contacts\s*\)/);
  });
});

describe('the drift alert', () => {
  it('says the document went to SoftPro\'s contact, and that the hub order was updated', () => {
    const decisions: PreSendDecision[] = [{
      role: 'escrow', status: 'differs', email: 'kim@inlandempireescrow.com', name: 'Kim', ours: 'm@premierpropertiesescrow.com',
    }];
    const { subject, html } = buildContactDriftAlertEmail({ orderId: 1, fileNumber: '20018662-GLT', sendKind: 'prelim', decisions });
    expect(subject).toBe("Preliminary report sent to SoftPro's contact, not ours — 20018662-GLT");
    expect(html).toContain('m@premierpropertiesescrow.com');
    expect(html).toContain('kim@inlandempireescrow.com');
    expect(html).toContain('hub contact on this order was updated');
    expect(html).not.toContain('Nothing in the hub was changed');
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

describe('T&E differs does not write an escrow_company party', () => {
  it('recordPreSendOutcome skips the party write when escrow comes from the officer field', () => {
    const src = readFileSync(resolve(__dirname, 'pre-send-refresh.ts'), 'utf8');
    const record = src.slice(src.indexOf('export async function recordPreSendOutcome'));
    expect(record).toContain("d.role === 'escrow' && escrowPreSendSource(input.orderType) === 'escrow_officer'");
    expect(record).toMatch(/const writeParty = d\.status === 'differs'/);
    expect(record).toContain('if (writeParty && d.status === \'differs\')');
  });
});
