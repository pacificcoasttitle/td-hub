// AI-assisted email drafts for the CRM "Email in Outlook" action.
//
// Everything in this file is PURE — context assembly, the prompt, and parsing.
// The Anthropic call itself lives in the route, so the prompt can be tested
// without a network or an API key.
//
// GROUNDING IS THE POINT. A draft that invents an order number, a closing date,
// or a promise about turn times is worse than no draft: the rep sends it, the
// client reads a fabricated fact, and the relationship pays for it. The model
// gets only facts we already hold, and is told in the prompt that inventing
// anything is a failure. See DRAFT_SYSTEM_PROMPT.

import type { ClientOrderMetrics } from './client-metrics';
import type { ClientSignal } from './client-signals';

/** Bodies go into a mailto: URL, which is plain text and truncates. */
export const MAX_BODY_CHARS = 1500;
export const MAX_SUBJECT_CHARS = 120;

export interface DraftContextInput {
  clientName: string;
  company: string | null;
  /** agent | lender | escrow | title | other */
  type: string | null;
  repName: string;
  metrics: ClientOrderMetrics;
  signal: ClientSignal;
  /** Newest first. Only the most recent few are used. */
  notes: Array<{ body: string; createdAt: Date }>;
}

export type DraftIntent = 're_engage' | 'appreciation' | 'value_add' | 'check_in';

export interface EmailDraft {
  intent: DraftIntent;
  /** Short human label for the tab/chip, e.g. "Re-engage". */
  label: string;
  subject: string;
  body: string;
}

/** How many recent notes to include. Enough for colour, not a dossier. */
const MAX_NOTES_IN_CONTEXT = 3;
const MAX_NOTE_CHARS = 300;

/**
 * The primary intent is biased to the client's current signal — a client who
 * has gone quiet needs a different opener from one sending more work than usual.
 */
export function primaryIntentFor(signal: ClientSignal): DraftIntent {
  switch (signal.kind) {
    case 'quiet': return 're_engage';
    case 'declining': return 're_engage';
    case 'momentum': return 'appreciation';
    case 'steady': return 'value_add';
    default: return 'check_in';
  }
}

/** The 3 intents offered, primary first. */
export function intentsFor(signal: ClientSignal): DraftIntent[] {
  const primary = primaryIntentFor(signal);
  const rest: DraftIntent[] = (['re_engage', 'appreciation', 'value_add', 'check_in'] as const)
    .filter((i) => i !== primary);
  return [primary, ...rest.slice(0, 2)];
}

export const INTENT_LABEL: Record<DraftIntent, string> = {
  re_engage: 'Re-engage',
  appreciation: 'Thank them',
  value_add: 'Useful touch',
  check_in: 'Check in',
};

const INTENT_BRIEF: Record<DraftIntent, string> = {
  re_engage:
    'Warm re-engagement. Acknowledge it has been a while WITHOUT guilt-tripping, '
    + 'and give them an easy reason to reply. Never imply they did anything wrong.',
  appreciation:
    'Thank them for the recent business and keep the momentum going. Specific, not gushing.',
  value_add:
    'A light, useful touch — offer help or availability. No hard ask.',
  check_in:
    'A short, friendly check-in. Low pressure, opens a conversation.',
};

/**
 * The facts the model may use. Deliberately narrow: counts and recency only,
 * which the attribution spike showed are our clean data. No revenue, no
 * closing rates, no per-order detail — see docs/referral-source-spike.md.
 */
export function buildFactSheet(input: DraftContextInput): string {
  const { metrics, signal } = input;
  const lines: string[] = [];

  lines.push(`Client: ${input.clientName}`);
  if (input.company) lines.push(`Company: ${input.company}`);
  if (input.type) lines.push(`Client type: ${input.type}`);
  lines.push(`Sales rep writing this email: ${input.repName}`);

  if (metrics.unlinked || metrics.counts.total === 0) {
    lines.push('Order history: none on record with this rep.');
  } else {
    lines.push(`Total orders with this rep: ${metrics.counts.total}`);
    lines.push(`Orders this month: ${metrics.counts.thisMonth}`);
    lines.push(`Orders in the last 90 days: ${metrics.counts.last90}`);
    if (metrics.recency.daysSinceLastOrder !== null) {
      lines.push(`Days since their last order: ${metrics.recency.daysSinceLastOrder}`);
    }
    if (metrics.rate.avgMonthlyOrders !== null) {
      lines.push(`Their typical pace: about ${metrics.rate.avgMonthlyOrders.toFixed(1)} orders a month`);
    }
  }

  if (signal.detail) lines.push(`Current read on the relationship: ${signal.detail}`);

  const notes = input.notes.slice(0, MAX_NOTES_IN_CONTEXT);
  if (notes.length > 0) {
    lines.push('');
    lines.push("Recent notes the rep has written about this client (the rep's own words):");
    for (const n of notes) {
      lines.push(`- ${n.body.slice(0, MAX_NOTE_CHARS).replace(/\s+/g, ' ').trim()}`);
    }
  }

  return lines.join('\n');
}

/**
 * Grounding rules. These are the whole point of the feature being safe to ship:
 * the model may reference only what is in the fact sheet, and the things it is
 * most likely to invent are named explicitly.
 */
export const DRAFT_SYSTEM_PROMPT = `You write short, professional emails for a sales representative at Pacific Coast Title, a title and escrow company in California. The rep will read your draft, edit it if they want, and send it themselves from Outlook. Nothing you write is sent automatically.

GROUNDING — this matters more than anything else:
- Use ONLY the facts given to you below. You have no other information about this client.
- NEVER invent an order number, a file number, a property address, a dollar amount, a closing date, a specific date, or the name of any person other than the rep and the client.
- NEVER promise anything on the company's behalf — no turn times, no pricing, no rate quotes, no guarantees about a file.
- If you do not have a fact, leave it out. Do not use placeholders like [DATE] or [PROPERTY]; the rep should be able to send the draft without filling in blanks.
- Referring to counts and timing that ARE in the facts is good ("it's been a while", "you've sent several files recently"). Prefer that phrasing over reciting exact numbers, which reads robotic.

TONE:
- Professional, warm, and brief. A real person writing to a working colleague.
- No marketing language, no exclamation marks, no "I hope this email finds you well".
- Do not open with the client's full name and company; a simple first-name greeting is right.
- Sign off with the rep's name exactly as given.

FORMAT:
- Subject line under ${MAX_SUBJECT_CHARS} characters.
- Body under ${MAX_BODY_CHARS} characters, plain text only. No markdown, no bullet characters, no links.
- Body must be complete and sendable as-is.`;

export function buildDraftPrompt(input: DraftContextInput): string {
  const intents = intentsFor(input.signal);
  const briefs = intents
    .map((i, n) => `${n + 1}. intent "${i}" (${INTENT_LABEL[i]}): ${INTENT_BRIEF[i]}`)
    .join('\n');

  return `Here are the only facts you have about this client:

${buildFactSheet(input)}

Write ${intents.length} alternative emails the rep could send, each with a different intent:

${briefs}

The first one is the best fit for where this relationship currently stands, so put your strongest effort there.`;
}

/** JSON Schema for the structured output — guarantees parseable drafts. */
export function draftResponseSchema(intents: DraftIntent[]) {
  return {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            intent: { type: 'string', enum: intents },
            subject: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['intent', 'subject', 'body'],
          additionalProperties: false,
        },
      },
    },
    required: ['drafts'],
    additionalProperties: false,
  } as const;
}

/**
 * Validates and clamps what came back. Structured outputs guarantee the shape,
 * not the content — a body over the mailto limit still has to be caught here.
 */
export function normalizeDrafts(raw: unknown, intents: DraftIntent[]): EmailDraft[] {
  const drafts = (raw as { drafts?: unknown })?.drafts;
  if (!Array.isArray(drafts)) return [];

  const out: EmailDraft[] = [];
  for (const d of drafts) {
    if (!d || typeof d !== 'object') continue;
    const { intent, subject, body } = d as Record<string, unknown>;
    if (typeof subject !== 'string' || typeof body !== 'string') continue;
    if (!subject.trim() || !body.trim()) continue;

    const resolved = (typeof intent === 'string' && intents.includes(intent as DraftIntent))
      ? intent as DraftIntent
      : intents[out.length] ?? 'check_in';

    out.push({
      intent: resolved,
      label: INTENT_LABEL[resolved],
      subject: subject.trim().slice(0, MAX_SUBJECT_CHARS),
      body: body.trim().slice(0, MAX_BODY_CHARS),
    });
  }
  return out;
}
