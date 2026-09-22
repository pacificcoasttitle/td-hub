import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── A send that cannot write its log row is not sent ───────────────────────
//
// Every test here records the ORDER of three things — the log row, the email,
// the settle — because the order is the rule. The prelim path logged after
// sending, best-effort, and recorded one delivery out of 1,083.

const s = vi.hoisted(() => ({
  events: [] as string[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  target: null as Record<string, unknown> | null,
  insertFails: false,
  pdfReadable: true,
  sendResult: { success: true, data: { messageId: 'sg-123' } } as Record<string, unknown>,
  sentEmails: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          if (s.insertFails) throw new Error('connection refused');
          s.events.push('log-row'); s.inserted.push(v); return [{ id: 31 }];
        },
      }),
    }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { s.events.push('settle'); s.updated.push(v); } }) }),
  },
}));
vi.mock('@/lib/integrations/s3/client', () => ({
  downloadFile: vi.fn(async () => (s.pdfReadable ? { success: true, data: Buffer.from('%PDF-1.3') } : { success: false })),
}));
vi.mock('@/lib/integrations/sendgrid/client', () => ({
  sendEmail: vi.fn(async (p: Record<string, unknown>) => { s.events.push('email'); s.sentEmails.push(p); return s.sendResult; }),
}));
vi.mock('./stored', async () => {
  const actual = await vi.importActual<typeof import('./stored')>('./stored');
  return { ...actual, getNotifyTarget: vi.fn(async () => s.target) };
});

const { notifyRep, OUTCOME_UNRECORDED } = await import('./notify');

const TARGET = {
  status: 'generated', pdfKey: 'reports/county_sales/3/report-x.pdf',
  repName: 'Mark Neveu', repEmail: 'mneveu@pct.com',
  subject: 'Orange County', subjectDetail: '44 cities', settings: 'August 2026',
  filename: 'Orange-County-August-2026.pdf',
};
const run = () => notifyRep({ type: 'county_sales', id: 3, sentBy: 'ops@pct.com' });

beforeEach(() => {
  s.events.length = 0; s.inserted.length = 0; s.updated.length = 0; s.sentEmails.length = 0;
  s.target = { ...TARGET }; s.insertFails = false; s.pdfReadable = true;
  s.sendResult = { success: true, data: { messageId: 'sg-123' } };
});

describe('the order is the rule', () => {
  it('writes the row, then sends, then records what happened', async () => {
    const r = await run();
    expect(r).toMatchObject({ ok: true, deliveryId: 31, recipientEmail: 'mneveu@pct.com' });
    expect(s.events).toEqual(['log-row', 'email', 'settle']);
  });

  it('SENDS NOTHING when the log row cannot be written', async () => {
    s.insertFails = true;
    await expect(run()).rejects.toThrow('connection refused');
    expect(s.sentEmails).toHaveLength(0);
  });

  it('writes the row as a failure until proven otherwise, so a crash mid-send is never silence', async () => {
    await run();
    expect(s.inserted[0]).toMatchObject({ outcome: 'failed', outcomeDetail: OUTCOME_UNRECORDED });
  });

  it('settles a success with the provider\'s message id', async () => {
    await run();
    // Sent, not delivered: acceptance is all the reply proves.
    expect(s.updated.at(-1)).toMatchObject({ outcome: 'sent' });
    expect(String(s.updated.at(-1)!.outcomeDetail)).toContain('Delivery not confirmed');
    expect(String(s.updated.at(-1)!.outcomeDetail)).toContain('sg-123');
  });

  it('settles a provider refusal with the provider\'s reason, verbatim', async () => {
    s.sendResult = { success: false, error: { message: 'The from address does not match a verified Sender Identity.' } };
    const r = await run();
    expect(r).toMatchObject({ ok: false, deliveryId: 31, reason: 'provider' });
    expect(s.updated.at(-1)).toEqual({ outcome: 'failed', outcomeDetail: 'The from address does not match a verified Sender Identity.' });
  });
});

describe('what it sends, and to whom', () => {
  it('sends to the rep on the report row', async () => {
    await run();
    expect(s.sentEmails[0]).toMatchObject({ to: 'mneveu@pct.com' });
    expect(s.inserted[0]).toMatchObject({ kind: 'notify_rep', recipientName: 'Mark Neveu', recipientEmail: 'mneveu@pct.com', sentBy: 'ops@pct.com' });
  });

  it('attaches the PDF — never a link — and records that it did', async () => {
    await run();
    const [a] = s.sentEmails[0]!.attachments as Array<Record<string, unknown>>;
    expect(a).toMatchObject({ type: 'application/pdf', filename: 'Orange-County-August-2026.pdf', disposition: 'attachment' });
    expect(Buffer.from(String(a!.content), 'base64').toString()).toBe('%PDF-1.3');
    expect(s.inserted[0]).toMatchObject({ payloadMode: 'attachment' });
    expect(String(s.sentEmails[0]!.html)).not.toMatch(/amazonaws|s3\./i);
  });

  it('names the report by its real name, never "Send"', async () => {
    await run();
    expect(s.sentEmails[0]!.subject).toBe('County Sales · Orange County · August 2026');
    expect(String(s.sentEmails[0]!.subject)).not.toMatch(/send/i);
  });
});

describe('what is not an attempt, and so writes nothing', () => {
  it('refuses a report that is not generated', async () => {
    s.target = { ...TARGET, status: 'failed', pdfKey: null };
    expect(await run()).toMatchObject({ ok: false, deliveryId: null, reason: 'not_generated' });
    expect(s.events).toEqual([]);
  });

  it('refuses a rep with no email, and says who', async () => {
    s.target = { ...TARGET, repEmail: '  ' };
    const r = await run();
    expect(r).toMatchObject({ ok: false, deliveryId: null, reason: 'no_email' });
    expect((r as { message: string }).message).toContain('Mark Neveu has no email address');
    expect(s.events).toEqual([]);
  });

  it('refuses a report that does not exist', async () => {
    s.target = null;
    expect(await run()).toMatchObject({ ok: false, deliveryId: null, reason: 'not_found' });
  });
});

describe('an attachment that cannot be read', () => {
  it('is a failed attempt with a row saying so, and no email', async () => {
    s.pdfReadable = false;
    const r = await run();
    expect(r).toMatchObject({ ok: false, deliveryId: 31, reason: 'pdf_unreadable' });
    expect(s.events).toEqual(['log-row', 'settle']);
    expect(s.updated.at(-1)).toMatchObject({ outcome: 'failed' });
  });
});
