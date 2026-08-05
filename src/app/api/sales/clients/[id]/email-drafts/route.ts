import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { CrmAccessError, getEmailDraftContext } from '@/lib/domain/crm/clients';
import {
  buildDraftPrompt,
  DRAFT_SYSTEM_PROMPT,
  draftResponseSchema,
  intentsFor,
  normalizeDrafts,
} from '@/lib/domain/crm/email-drafts';
import {
  AnthropicNotConfiguredError,
  DRAFT_MODEL,
  getAnthropicClient,
} from '@/lib/integrations/anthropic/client';
import { checkDraftRateLimit, recordDraftCall } from '@/lib/integrations/anthropic/rate-limit';

// AI email drafts for one client.
//
// The browser calls this route; this route calls Anthropic. ANTHROPIC_API_KEY is
// read server-side in the client module and is never sent to, or reachable from,
// the browser.
//
// Nothing here sends an email. The response is text the rep reads, edits, and
// then hands to Outlook themselves.

export const maxDuration = 60;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: rawId } = await params;
  const clientId = parseId(rawId);
  if (clientId === null) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Ownership first, before anything that costs money. getEmailDraftContext
  // resolves through getOwnedClient: not visible → 404, visible but not owned
  // → 403 (the same rule that governs edits).
  let context: Awaited<ReturnType<typeof getEmailDraftContext>>;
  try {
    context = await getEmailDraftContext(session, clientId);
  } catch (err) {
    if (err instanceof CrmAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Then the budget. Checked after auth so an unauthenticated caller can never
  // consume a legitimate rep's allowance.
  const limit = await checkDraftRateLimit(session.id);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `You have generated ${limit.used} sets of drafts in the last hour. `
          + 'Give it a little while before generating more.',
        rateLimited: true,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const intents = intentsFor(context.signal);
  const startedAt = new Date();

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 4000,
      // NO effort parameter: DRAFT_MODEL is Haiku 4.5, which rejects it with a
      // 400. That failure would be near-invisible here — the catch below turns
      // every error into 200-with-empty-drafts, so a rejected parameter reads
      // to a rep as "the AI just never works". A test asserts effort is absent.
      //
      // max_tokens is a ceiling, not a target: real generations run ~280 output
      // tokens, so this is headroom against a truncated (and therefore
      // unparseable) JSON response, not a cost or latency lever.
      output_config: {
        format: { type: 'json_schema', schema: draftResponseSchema(intents) },
      },
      system: DRAFT_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: buildDraftPrompt({
          clientName: context.client.name,
          company: context.client.company,
          type: context.client.type,
          repName: context.repName,
          metrics: context.metrics,
          signal: context.signal,
          notes: context.notes,
        }),
      }],
    });

    // Structured outputs guarantee the shape; a refusal still has to be caught
    // before reading content.
    if (response.stop_reason === 'refusal') {
      await recordDraftCall({
        profileId: session.id, clientId, success: false, startedAt,
        errorCategory: 'refusal', model: DRAFT_MODEL,
      });
      return NextResponse.json(
        { error: 'The assistant declined to write these drafts.', drafts: [] },
        { status: 200 },
      );
    }

    const text = response.content.find((b) => b.type === 'text');
    const parsed = text && text.type === 'text' ? JSON.parse(text.text) : null;
    const drafts = normalizeDrafts(parsed, intents);

    await recordDraftCall({
      profileId: session.id, clientId, success: true, startedAt,
      model: DRAFT_MODEL, usage: response.usage,
    });

    return NextResponse.json({ drafts, remaining: limit.limit - limit.used - 1 });
  } catch (err) {
    const notConfigured = err instanceof AnthropicNotConfiguredError;
    await recordDraftCall({
      profileId: session.id, clientId, success: false, startedAt,
      errorCategory: notConfigured ? 'not_configured' : 'api_error',
      model: DRAFT_MODEL,
    });

    // GRACEFUL FAILURE. 200 with an empty draft list, not a 5xx: the modal
    // shows a friendly message and still offers the plain Outlook open, so a
    // broken AI call never takes away the email action the rep had before.
    console.error('[crm/email-drafts] generation failed:', err);
    return NextResponse.json(
      {
        drafts: [],
        error: notConfigured
          ? 'Draft suggestions are not set up yet.'
          : 'Could not generate drafts just now.',
      },
      { status: 200 },
    );
  }
}
