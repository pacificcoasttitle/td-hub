/** Guaranteed CC on every open-order confirmation — zero-recipient becomes impossible. */
export const OPEN_ORDERS_CONFIRMATION_CC = 'openorders@pct.com';

export interface ConfirmationRecipientInput {
  clientEmail: string | null | undefined;
  escrowOfficerEmail?: string | null;
  listingAgentEmail?: string | null;
  buyerAgentEmail?: string | null;
  salesRepEmail?: string | null;
  /** Comma-separated optional extras from PCT_INTERNAL_CC_EMAILS */
  internalCcEmails?: string | null;
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
  ].filter((e): e is string => !!e);

  let to = [...new Set(toCandidates)];
  let cc = [...new Set(ccCandidates)].filter((e) => !to.includes(e));

  // Guaranteed delivery: if TO is empty, promote openorders into TO.
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
