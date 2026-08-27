import { NextRequest, NextResponse } from 'next/server';
import { submitPartyWizard } from '@/lib/domain/parties/party-wizard-service';

// ─── Party wizard submission ─────────────────────────────────────────────────
//
// Session-public: the HMAC token IS the credential, verified in the service.
// External parties have no TD Hub login, so requiring a session would 401 the
// exact people this exists for.
//
// The token lives in the PATH, never in a query string or the response body, so
// it stays out of referrer headers and access logs that record query strings.

export const runtime = 'nodejs';

/** One generic message per failure class — never confirm whether an id exists. */
const FAILURE_MESSAGES: Record<string, { status: number; message: string }> = {
  invalid: { status: 404, message: 'This link is not valid.' },
  // Revoked and expired share one reason and one message on purpose — telling
  // them apart would confirm that a link had been deliberately withdrawn.
  inactive: { status: 410, message: 'This link is no longer active. Please contact your escrow officer.' },
  unsupported: { status: 400, message: 'This link cannot be completed online.' },
  misconfigured: { status: 503, message: 'This form is temporarily unavailable.' },
  rate_limited: { status: 429, message: 'Too many submissions. Please wait a few minutes and try again.' },
  validation: { status: 400, message: 'Please check the highlighted fields.' },
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const result = await submitPartyWizard(token, body);

  if (!result.ok) {
    const failure = FAILURE_MESSAGES[result.reason] ?? FAILURE_MESSAGES.invalid;
    return NextResponse.json(
      { error: failure.message, fieldErrors: result.fieldErrors ?? undefined },
      { status: failure.status },
    );
  }

  // The note outcome is deliberately not surfaced to the submitter: from their
  // side the answer is recorded either way, and a failed note is our problem to
  // retry, not something to worry them with.
  return NextResponse.json({ ok: true });
}
