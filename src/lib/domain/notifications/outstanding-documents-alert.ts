/**
 * Tell PCT's team to send the documents the confirmation went out without.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The confirmation waits for the title searches and then sends regardless. On
 * 60 of 244 confirmations in the last 90 days it sent with a promised document
 * still outstanding, and the body told the customer the documents would follow
 * separately. **Nothing sent them.** No follow-up existed, in code or in
 * anyone's routine — the sentence was a promise the product could not keep.
 *
 * So this is the thing that keeps it. Not a second customer-facing email: an
 * internal alert telling a person what to forward and to whom.
 *
 * ─── WHY IT FIRES ON ARRIVAL, NOT ON SEND ───────────────────────────────────
 *
 * At send time the document does not exist, so an alert then is unactionable —
 * the reader would have to remember to come back. Firing when the document
 * lands means opening the alert and forwarding it in the same minute.
 *
 * The wait is short. Of 97 documents that arrived after their confirmation,
 * the median was 1.0 minutes and the slowest was 6.6. Nothing took hours.
 *
 * ─── WHY THERE IS A FALLBACK ────────────────────────────────────────────────
 *
 * Because "arrives late" is not the only failure. 13 of those 60 orders never
 * got the document AT ALL — the search returned nothing or failed outright.
 * Waiting for an arrival that never comes would mean the worst case is the one
 * case that stays silent, which is how this whole defect went unnoticed. After
 * the fallback window the alert fires anyway and says so.
 *
 * ─── WHY IT SURVIVES THE PIPELINE REBUILD ───────────────────────────────────
 *
 * The rebuild makes the confirmation wait for the documents, which removes the
 * race. It does not make TitlePoint return a document it does not have. An
 * order whose legal vesting fails still needs a human told, and this is what
 * tells them. Unlike a customer-facing follow-up, it does not become dead
 * weight the day the rebuild lands.
 */

import {
  CONFIRMATION_DOC_LABELS,
  CONFIRMATION_DOC_TYPES,
  CONFIRMATION_OPTIONAL_DOC_TYPES,
  type ConfirmationDocType,
} from './confirmation-documents';
import {
  APP_BASE_URL,
  calloutBar,
  ctaButton,
  emailShell,
  esc,
  fieldTable,
  sectionLabel,
} from './email-layout';

/**
 * Slug AND dispatch event type — `mapEventToSlug` falls through to the event
 * type for anything it does not special-case, so these must stay the same
 * string. Recipients live in `notification_types.internal_cc`, editable in
 * Admin → Notifications, same as Request Updated Prelim.
 */
export const OUTSTANDING_ALERT_EVENT_TYPE = 'order.documents.outstanding';

/**
 * How long to wait for a document before reporting that it never came.
 *
 * The slowest late arrival on record is 6.6 minutes, so this is not a finely
 * tuned number — it is deliberately far past the tail so that "it never came"
 * means it never came, rather than "we got bored". Two hours is roughly 18x
 * the worst observed case.
 */
export const OUTSTANDING_ALERT_FALLBACK_MINUTES = 120;

/**
 * How far back the scanner looks. An order past this is abandoned rather than
 * rescanned forever — without it, one order whose recipients are misconfigured
 * would be retried every two minutes indefinitely.
 *
 * Counted from `alertClock().anchor`, not always from the confirmation. A
 * title search that starts after the confirmation has already gone out
 * restarts this window from that search — otherwise the documents land
 * outside the 24 hours and nobody is told.
 */
export const OUTSTANDING_ALERT_SCAN_WINDOW_HOURS = 24;

export interface AlertClock {
  /** 24-hour window and two-hour wait both count from here. */
  anchor: Date;
  /**
   * True when an existing outstanding alert still covers this generation.
   * False when a title search started after that alert (or after the
   * confirmation, with no alert yet) — the once-only rule restarts.
   */
  priorAlertCounts: boolean;
  restartedFromSearch: boolean;
}

/**
 * Where the alert's clocks start.
 *
 * Default: the confirmation send. When a title search starts *after* that
 * send, the 24-hour window, the two-hour wait, and the once-only latch all
 * restart from the first such search. That is the seven-order case:
 * confirmation went out with nothing attached, the search began later, the
 * documents arrived, and the confirmation-anchored clocks had already
 * closed or already fired `never_arrived`.
 */
export function alertClock(input: {
  confirmationSentAt: Date;
  searchStartedAts: readonly Date[];
  lastAlertAt: Date | null;
}): AlertClock {
  const searchesAfterConfirm = input.searchStartedAts
    .filter((started) => started.getTime() > input.confirmationSentAt.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  const generationStart = searchesAfterConfirm[0] ?? null;

  if (!generationStart) {
    return {
      anchor: input.confirmationSentAt,
      priorAlertCounts: input.lastAlertAt != null,
      restartedFromSearch: false,
    };
  }

  return {
    anchor: generationStart,
    priorAlertCounts:
      input.lastAlertAt != null
      && input.lastAlertAt.getTime() >= generationStart.getTime(),
    restartedFromSearch: true,
  };
}

function isOptional(category: string): boolean {
  return (CONFIRMATION_OPTIONAL_DOC_TYPES as readonly string[]).includes(category);
}

export type OutstandingAlertReason = 'arrived' | 'never_arrived';

export interface OutstandingAlertDecision {
  fire: boolean;
  reason: OutstandingAlertReason | null;
  /** Missing from the email, present now — the things to forward. */
  available: ConfirmationDocType[];
  /** Promised, still absent at the fallback. Only ever non-optional. */
  neverCame: ConfirmationDocType[];
}

const NO_ALERT: OutstandingAlertDecision = {
  fire: false,
  reason: null,
  available: [],
  neverCame: [],
};

/**
 * Should this confirmation produce an alert yet, and what would it say?
 *
 * Pure, because these rules are the whole feature and they should be readable
 * without a database. Everything else here is plumbing.
 */
export function decideOutstandingAlert(input: {
  /** Categories the confirmation did NOT carry. */
  missingAtSend: readonly string[];
  /** Categories active on the order right now. */
  presentNow: readonly string[];
  minutesSinceSend: number;
  fallbackMinutes?: number;
}): OutstandingAlertDecision {
  const fallback = input.fallbackMinutes ?? OUTSTANDING_ALERT_FALLBACK_MINUTES;

  // Ordered by CONFIRMATION_DOC_TYPES throughout so the alert lists documents
  // the same way the confirmation does, whatever order rows come back in.
  const missing = CONFIRMATION_DOC_TYPES.filter((c) => input.missingAtSend.includes(c));
  if (missing.length === 0) return NO_ALERT;

  const available = missing.filter((c) => input.presentNow.includes(c));
  const requiredStillMissing = missing.filter(
    (c) => !isOptional(c) && !input.presentNow.includes(c),
  );

  // Everything the customer was promised is now in hand. Fire, and carry the
  // optional documents that happened to land too — a grant deed the customer
  // did not get is worth forwarding whether or not it was promised.
  //
  // Waiting for ALL of them rather than firing per document is deliberate: two
  // alerts for one order is how a person learns to skim them. The cost is that
  // one stuck document delays news of the others, which the fallback bounds.
  if (requiredStillMissing.length === 0 && available.length > 0) {
    return { fire: true, reason: 'arrived', available, neverCame: [] };
  }

  if (input.minutesSinceSend >= fallback) {
    // Nothing promised is missing and nothing arrived — the only way here is an
    // optional document that never materialised, i.e. no qualifying grant deed
    // exists. Nothing is coming, nobody was told it was, and there is nothing
    // for a human to do. Alerting would be noise on a non-event.
    if (requiredStillMissing.length === 0) return NO_ALERT;

    return { fire: true, reason: 'never_arrived', available, neverCame: requiredStillMissing };
  }

  return NO_ALERT;
}

/** Categories the confirmation should have carried but did not. */
export function missingFromConfirmation(attached: readonly string[]): ConfirmationDocType[] {
  return CONFIRMATION_DOC_TYPES.filter((c) => !attached.includes(c));
}

function labelList(categories: readonly ConfirmationDocType[]): string {
  return categories.map((c) => CONFIRMATION_DOC_LABELS[c]).join(', ');
}

export interface OutstandingAlertEmailInput {
  orderId: number;
  fileNumber: string;
  address: string | null;
  clientName: string | null;
  clientEmail: string | null;
  decision: OutstandingAlertDecision;
  sentAt: Date;
}

/**
 * Enough to act on without opening three screens: who to send to, what to
 * send, and one link to the file.
 */
export function buildOutstandingAlertEmail(
  input: OutstandingAlertEmailInput,
): { subject: string; html: string } {
  const { decision } = input;
  const arrived = decision.reason === 'arrived';

  const subject = arrived
    ? `Send to client: ${labelList(decision.available)} — ${input.fileNumber}`
    : `Title documents never arrived — ${input.fileNumber}`;

  const clientLine = input.clientEmail
    ? `<a href="mailto:${esc(input.clientEmail)}" style="color:#F26B2B;text-decoration:none;">${esc(input.clientEmail)}</a>`
    : '<span style="color:#B91C1C;">No client email on this order</span>';

  const rows = [
    { label: 'File number', valueHtml: esc(input.fileNumber) },
    { label: 'Property', valueHtml: esc(input.address ?? '—') },
    { label: 'Send to', valueHtml: esc(input.clientName ?? 'Client') },
    { label: 'Email', valueHtml: clientLine },
  ];

  if (decision.available.length > 0) {
    rows.push({ label: 'Ready to send', valueHtml: esc(labelList(decision.available)) });
  }
  if (decision.neverCame.length > 0) {
    rows.push({ label: 'Never arrived', valueHtml: esc(labelList(decision.neverCame)) });
  }

  const sentAtLabel = input.sentAt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

  const callout = arrived
    ? `<strong>The confirmation for this file went out without ${esc(labelList(decision.available))}.</strong> `
      + `It was sent at ${esc(sentAtLabel)}, before the document${decision.available.length > 1 ? 's were' : ' was'} ready. `
      + 'The customer was told the title documents would follow — please send them now.'
    : `<strong>${esc(labelList(decision.neverCame))} never arrived for this file.</strong> `
      + `The confirmation went out at ${esc(sentAtLabel)} telling the customer the title documents would follow, and `
      + `${decision.neverCame.length > 1 ? 'they have' : 'it has'} still not been produced after `
      + `${OUTSTANDING_ALERT_FALLBACK_MINUTES / 60} hours. The search likely failed or returned nothing. `
      + 'This one needs looking at, not just forwarding.';

  const bodyHtml = [
    sectionLabel(arrived ? 'Documents ready to send' : 'Documents never produced'),
    fieldTable(rows),
    calloutBar(callout),
    `<div style="margin-top:26px;">${ctaButton('Open order', `${APP_BASE_URL}/orders/${input.orderId}`)}</div>`,
  ].join('');

  return {
    subject,
    html: emailShell({
      title: subject,
      badge: arrived ? 'Action required' : 'Needs attention',
      preheader: arrived
        ? `${labelList(decision.available)} for ${input.fileNumber} — send to the client.`
        : `${labelList(decision.neverCame)} for ${input.fileNumber} was never produced.`,
      hero: {
        icon: arrived ? '↗' : '!',
        eyebrow: arrived ? 'Send to client' : 'Never arrived',
        headline: arrived ? 'Documents ready to send' : 'Documents never arrived',
        subcopy: arrived
          ? 'The confirmation went out without these. They are ready now.'
          : 'The confirmation promised these and they were never produced.',
      },
      tracker: { stage: 1, fileNumber: input.fileNumber, address: input.address },
      bodyHtml,
    }),
  };
}
