// ─── INVARIANTS ─────────────────────────────────────────────────────────────
//
// Two properties that must hold for every confirmation, whatever else changes
// here. They are named because tests record that they hold today; a name
// records that they are meant to.
//
// I1. A CONFIRMATION ALWAYS HAS AT LEAST ONE RECIPIENT.
//     openorders@pct.com is CC'd on every send, and promoted to TO when TO
//     would otherwise be empty. Nothing added to this function may displace it
//     — a new candidate list can only ever grow CC, never remove that address
//     or take its place in the promotion.
//
// I2. AN OPERATOR-TYPED ADDRESS IS NEVER PROMOTABLE TO TO.
//     Deliverable emails are copies. The responsible party — the client, then
//     the escrow officer, listing agent, buyer's agent — holds TO. An address
//     someone typed into a form must not become the primary recipient of a
//     client-facing document, and must not become one by the side effect of
//     every other candidate being absent. That is why the promotion at the
//     bottom of this function names openorders explicitly rather than
//     promoting "the first available CC".
//
// Both are covered by deliverable-emails.test.ts, including the case where
// there is no client at all.

/** Guaranteed CC on every open-order confirmation — zero-recipient becomes impossible. */
export const OPEN_ORDERS_CONFIRMATION_CC = 'openorders@pct.com';

export interface ConfirmationRecipientInput {
  clientEmail: string | null | undefined;
  escrowOfficerEmail?: string | null;
  listingAgentEmail?: string | null;
  /**
   * Gated by `BUYER_AGENT_RECIPIENT_SETTING` in `loadRecipientEmails`, which
   * passes null while that setting is off. This function stays a pure
   * candidate-to-TO/CC mapping and takes no view on it. `resolveRecipients`
   * gates the same decision on the same setting for every other send.
   */
  buyerAgentEmail?: string | null;
  salesRepEmail?: string | null;
  /** Comma-separated optional extras from PCT_INTERNAL_CC_EMAILS */
  internalCcEmails?: string | null;
  /**
   * Per-order deliverable addresses, ALREADY LOADED FROM THE DATABASE by the
   * caller via `deliverableEmailsForSend(orderId)`.
   *
   * This function is pure, so it cannot enforce where they came from — the
   * enforcement lives in the loader having no parameter that accepts an
   * address. Passing anything here that did not come from that loader defeats
   * the rule; see deliverable-emails.ts.
   */
  deliverableEmails?: string[] | null;
}

export interface ConfirmationRecipients {
  to: string[];
  cc: string[];
  clientRecipientPresent: boolean;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * Resolve confirmation TO/CC.
 * Client (form opener) is the primary intended recipient; openorders@pct.com is always CC'd
 * (or TO if no other recipients exist).
 */
export function buildConfirmationRecipients(input: ConfirmationRecipientInput): ConfirmationRecipients {
  const clientEmail = normalizeEmail(input.clientEmail);
  const toCandidates = [
    clientEmail,
    normalizeEmail(input.escrowOfficerEmail),
    normalizeEmail(input.listingAgentEmail),
    normalizeEmail(input.buyerAgentEmail),
  ].filter((e): e is string => !!e);

  const ccCandidates = [
    normalizeEmail(input.salesRepEmail),
    OPEN_ORDERS_CONFIRMATION_CC,
    ...(input.internalCcEmails ?? '')
      .split(',')
      .map((e) => normalizeEmail(e)),
    // Requested by the operator on the order. CC, never TO — the responsible
    // party stays in TO and these are copies. Ordered after openorders@pct.com
    // so the guaranteed-delivery promotion below is unaffected by them.
    ...(input.deliverableEmails ?? []).map((e) => normalizeEmail(e)),
  ].filter((e): e is string => !!e);

  let to = [...new Set(toCandidates)];
  let cc = [...new Set(ccCandidates)].filter((e) => !to.includes(e));

  // I1 and I2 together. Promotes openorders BY NAME, never "the first CC" —
  // otherwise an operator-typed deliverable address would become the primary
  // recipient on any order lacking a client, which is exactly I2.
  if (to.length === 0) {
    to = [OPEN_ORDERS_CONFIRMATION_CC];
    cc = cc.filter((e) => e !== OPEN_ORDERS_CONFIRMATION_CC);
  }

  return {
    to,
    cc,
    clientRecipientPresent: !!clientEmail,
  };
}
