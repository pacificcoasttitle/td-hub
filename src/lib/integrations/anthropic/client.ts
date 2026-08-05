// Anthropic client for the CRM email-draft feature.
//
// SERVER-SIDE ONLY. ANTHROPIC_API_KEY is read here and never leaves the server:
// it is not NEXT_PUBLIC_, it is not returned in any response, and the browser
// calls our route rather than Anthropic. Importing this module from a client
// component would be a build error, which is the guardrail we want.

import Anthropic from '@anthropic-ai/sdk';

/** Client-facing emails, so quality beats the last few cents of cost. */
export const DRAFT_MODEL = 'claude-opus-5';

/**
 * The rep is staring at a spinner, so cap the wait well under the Vercel
 * function ceiling. The SDK takes MILLISECONDS.
 */
export const DRAFT_TIMEOUT_MS = 45_000;

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
