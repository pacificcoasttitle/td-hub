import { describe, expect, it } from 'vitest';
import { computeClientMetrics, type ClientOrderRow } from './client-metrics';
import { deriveSignal } from './client-signals';
import {
  buildDraftPrompt,
  buildFactSheet,
  DRAFT_SYSTEM_PROMPT,
  draftResponseSchema,
  intentsFor,
  MAX_BODY_CHARS,
  MAX_SUBJECT_CHARS,
  normalizeDrafts,
  primaryIntentFor,
  type DraftContextInput,
} from './email-drafts';

const NOW = new Date('2026-08-05T12:00:00Z');

function order(id: number, daysAgo: number): ClientOrderRow {
  return {
    orderId: id,
    openedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    closedAt: null,
    operationalStatus: 'closed',
  };
}

function ctx(orders: ClientOrderRow[], over: Partial<DraftContextInput> = {}): DraftContextInput {
  const metrics = computeClientMetrics({ clientId: 1, contactId: 10, orders, now: NOW });
  return {
    clientName: 'Paul Rivera',
    company: 'Escrow Forum',
    type: 'escrow',
    repName: 'Angeline Ahn',
    metrics,
    signal: deriveSignal(metrics),
    notes: [],
    ...over,
  };
}

/** ~6 orders/month for a year, last one `gap` days ago. */
function steadyClient(gap: number): ClientOrderRow[] {
  return Array.from({ length: 72 }, (_, i) => order(i + 1, gap + i * 5));
}

// ─── Grounding: the safety property ────────────────────────────────────────

describe('grounding instructions', () => {
  it('names every category the model is most likely to fabricate', () => {
    for (const forbidden of [
      'order number', 'file number', 'property address',
      'dollar amount', 'closing date',
    ]) {
      expect(DRAFT_SYSTEM_PROMPT).toContain(forbidden);
    }
  });

  it('forbids promises made on the company’s behalf', () => {
    expect(DRAFT_SYSTEM_PROMPT).toContain('NEVER promise anything');
    expect(DRAFT_SYSTEM_PROMPT).toContain('turn times');
  });

  it('forbids placeholders, so a draft is sendable without filling blanks', () => {
    expect(DRAFT_SYSTEM_PROMPT).toContain('[DATE]');
    expect(DRAFT_SYSTEM_PROMPT).toContain('Do not use placeholders');
  });

  it('states the only-these-facts rule and the length limits', () => {
    expect(DRAFT_SYSTEM_PROMPT).toContain('Use ONLY the facts given to you');
    expect(DRAFT_SYSTEM_PROMPT).toContain(String(MAX_BODY_CHARS));
    expect(DRAFT_SYSTEM_PROMPT).toContain(String(MAX_SUBJECT_CHARS));
  });
});

// ─── Context assembly ──────────────────────────────────────────────────────

describe('buildFactSheet', () => {
  it('includes the real counts, recency and cadence', () => {
    const sheet = buildFactSheet(ctx(steadyClient(41)));
    expect(sheet).toContain('Paul Rivera');
    expect(sheet).toContain('Escrow Forum');
    expect(sheet).toContain('Angeline Ahn');
    expect(sheet).toContain('Total orders with this rep: 72');
    expect(sheet).toContain('Days since their last order: 41');
    expect(sheet).toMatch(/typical pace: about \d/);
  });

  it('never leaks revenue or per-order identifiers', () => {
    const sheet = buildFactSheet(ctx(steadyClient(10)));
    // The engine holds no revenue and the sheet exposes no file numbers —
    // the model cannot invent from facts it was never given.
    expect(sheet.toLowerCase()).not.toContain('revenue');
    expect(sheet).not.toMatch(/\$/);
    expect(sheet.toLowerCase()).not.toContain('file number');
    expect(sheet.toLowerCase()).not.toContain('address');
  });

  it('says plainly when there is no history rather than implying any', () => {
    const sheet = buildFactSheet(ctx([]));
    expect(sheet).toContain('Order history: none on record');
    expect(sheet).not.toContain('Total orders');
  });

  it('includes recent notes, capped and flattened', () => {
    const notes = [
      { body: 'Prefers a call.\nAvoid Fridays.', createdAt: NOW },
      { body: 'Sent fee schedule', createdAt: NOW },
      { body: 'Met at the mixer', createdAt: NOW },
      { body: 'SHOULD NOT APPEAR — fourth note', createdAt: NOW },
    ];
    const sheet = buildFactSheet(ctx(steadyClient(10), { notes }));
    expect(sheet).toContain('Prefers a call. Avoid Fridays.');
    expect(sheet).toContain('Met at the mixer');
    expect(sheet).not.toContain('SHOULD NOT APPEAR');
  });

  it('truncates a very long note instead of blowing the prompt', () => {
    const notes = [{ body: 'x'.repeat(2000), createdAt: NOW }];
    const sheet = buildFactSheet(ctx(steadyClient(10), { notes }));
    expect(sheet.length).toBeLessThan(1500);
  });
});

// ─── Intent selection follows the signal ───────────────────────────────────

describe('intent is biased to the client’s current signal', () => {
  it('gone-quiet leads with re-engagement', () => {
    const c = ctx(steadyClient(60));
    expect(c.signal.kind).toBe('quiet');
    expect(primaryIntentFor(c.signal)).toBe('re_engage');
  });

  it('momentum leads with appreciation', () => {
    const rows: ClientOrderRow[] = [];
    for (let i = 0; i < 24; i++) rows.push(order(100 + i, 15 + i * 15));
    rows.push(order(1, 0), order(2, 1), order(3, 2), order(4, 3));
    const c = ctx(rows);
    expect(c.signal.kind).toBe('momentum');
    expect(primaryIntentFor(c.signal)).toBe('appreciation');
  });

  it('steady leads with a light value-add touch', () => {
    const rows = [
      order(1, 5), order(2, 20), order(3, 35), order(4, 50), order(5, 65), order(6, 80),
      order(7, 95), order(8, 110), order(9, 125), order(10, 140), order(11, 155), order(12, 170),
    ];
    const c = ctx(rows);
    expect(c.signal.kind).toBe('steady');
    expect(primaryIntentFor(c.signal)).toBe('value_add');
  });

  it('a declining client is also offered re-engagement', () => {
    const rows = [
      order(1, 10), order(2, 40),
      order(3, 100), order(4, 110), order(5, 120), order(6, 130),
      order(7, 140), order(8, 150), order(9, 160), order(10, 170), order(11, 175),
    ];
    const c = ctx(rows);
    expect(c.signal.kind).toBe('declining');
    expect(primaryIntentFor(c.signal)).toBe('re_engage');
  });

  it('always offers exactly 3 distinct intents, primary first', () => {
    const c = ctx(steadyClient(60));
    const intents = intentsFor(c.signal);
    expect(intents).toHaveLength(3);
    expect(new Set(intents).size).toBe(3);
    expect(intents[0]).toBe(primaryIntentFor(c.signal));
  });
});

describe('buildDraftPrompt', () => {
  it('asks for one email per intent and marks the primary as most important', () => {
    const c = ctx(steadyClient(60));
    const prompt = buildDraftPrompt(c);
    expect(prompt).toContain('Write 3 alternative emails');
    expect(prompt).toContain('intent "re_engage"');
    expect(prompt).toContain('strongest effort');
    // The facts travel with the ask.
    expect(prompt).toContain('Angeline Ahn');
  });

  it('tells a re-engagement draft not to guilt-trip', () => {
    expect(buildDraftPrompt(ctx(steadyClient(60)))).toContain('WITHOUT guilt-tripping');
  });
});

// ─── Response handling ─────────────────────────────────────────────────────

describe('draftResponseSchema', () => {
  it('constrains intent to the offered set and forbids extra keys', () => {
    const schema = draftResponseSchema(['re_engage', 'value_add', 'check_in']);
    const item = schema.properties.drafts.items;
    expect(item.properties.intent.enum).toEqual(['re_engage', 'value_add', 'check_in']);
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(['intent', 'subject', 'body']);
  });
});

describe('normalizeDrafts', () => {
  const intents = ['re_engage', 'value_add', 'check_in'] as const;

  it('passes valid drafts through with a display label', () => {
    const out = normalizeDrafts({
      drafts: [{ intent: 're_engage', subject: 'Checking in', body: 'Hi Paul,\n\nAngeline' }],
    }, [...intents]);
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe('Re-engage');
  });

  it('clamps an over-long body to the mailto budget', () => {
    const out = normalizeDrafts({
      drafts: [{ intent: 're_engage', subject: 's'.repeat(500), body: 'b'.repeat(9000) }],
    }, [...intents]);
    expect(out[0]!.body.length).toBe(MAX_BODY_CHARS);
    expect(out[0]!.subject.length).toBe(MAX_SUBJECT_CHARS);
  });

  it('drops empty or malformed entries rather than showing a blank draft', () => {
    const out = normalizeDrafts({
      drafts: [
        { intent: 're_engage', subject: '', body: 'x' },
        { intent: 're_engage', subject: 'ok', body: '   ' },
        null,
        'nonsense',
        { intent: 're_engage', subject: 'Good', body: 'Real body' },
      ],
    }, [...intents]);
    expect(out).toHaveLength(1);
    expect(out[0]!.subject).toBe('Good');
  });

  it('survives a shape it did not expect', () => {
    expect(normalizeDrafts(null, [...intents])).toEqual([]);
    expect(normalizeDrafts({}, [...intents])).toEqual([]);
    expect(normalizeDrafts({ drafts: 'nope' }, [...intents])).toEqual([]);
  });

  it('falls back to a positional intent if the model returns an unknown one', () => {
    const out = normalizeDrafts({
      drafts: [{ intent: 'wildcard', subject: 'S', body: 'B' }],
    }, [...intents]);
    expect(out[0]!.intent).toBe('re_engage');
  });
});
