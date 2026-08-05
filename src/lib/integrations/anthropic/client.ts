// Anthropic client for the CRM email-draft feature.
//
// SERVER-SIDE ONLY. ANTHROPIC_API_KEY is read here and never leaves the server:
// it is not NEXT_PUBLIC_, it is not returned in any response, and the browser
// calls our route rather than Anthropic. Importing this module from a client
// component would be a build error, which is the guardrail we want.

import Anthropic from '@anthropic-ai/sdk';

/**
 * A rep is watching a spinner, so latency is the quality that matters most
 * here. Measured on real clients: Haiku 4.5 p50 ~3.6s against Opus 5 ~9.4s,
 * for drafts a rep edits anyway.
 *
 * NOTE FOR ANYONE CHANGING THIS: Haiku 4.5 does NOT support output_config.effort
 * (the Models API reports effort.supported = false, and sending it returns
 * "400 This model does not support the effort parameter"). The request in the
 * route therefore omits effort. If you move to an Opus or Sonnet model, add it
 * back — those models think by default, and without effort:'low' they are
 * SLOWER than Opus-with-effort, not faster. Measured: Sonnet 5 p50 8.3s with
 * effort:'low', 14.4s without.
 */
export const DRAFT_MODEL = 'claude-haiku-4-5';

/**
 * The rep is staring at a spinner, so cap the wait well under the Vercel
 * function ceiling. The SDK takes MILLISECONDS.
 *
 * This must leave room for the retry below: timeout x 2 attempts has to stay
 * under the route's maxDuration of 60s, or the function is killed mid-retry and
 * the graceful-failure path never runs. 25s x 2 = 50s, and the slowest real
 * generation observed was 18s.
 */
export const DRAFT_TIMEOUT_MS = 25_000;

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not configured');
  }
}

let cached: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AnthropicNotConfiguredError();

  if (!cached) {
    cached = new Anthropic({
      apiKey,
      timeout: DRAFT_TIMEOUT_MS,
      // One retry only: a rep waiting on a modal would rather see the fallback
      // than sit through three backoffs, and each retry is another paid call.
      maxRetries: 1,
    });
  }
  return cached;
}
