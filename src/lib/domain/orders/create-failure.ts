/**
 * What a failed hub create recorded, said in words, and the alert that says it.
 *
 * The recorder (`recordCreateLocalFailure` in create-order.ts) stores the
 * Postgres fields. This turns them into a sentence an operator can read, and
 * builds the internal email that means Gerard's team hears about a half-created
 * order from the system rather than from the operator who hit it.
 *
 * Pure — no database — so the wording is testable and previewable.
 */
import {
  APP_BASE_URL, calloutBar, ctaButton, emailShell, esc, fieldTable, sectionLabel,
} from '@/lib/domain/notifications/email-layout';

/**
 * Slug AND dispatch event type — `mapEventToSlug` falls through to the event
 * type, so these must be the same string. Recipients live in
 * `notification_types.internal_cc` (migration 0048), editable in Admin →
 * Notifications without a deploy.
 */
export const CREATE_FAILURE_ALERT_EVENT_TYPE = 'order.create.local_failed';

/** The shape `recordCreateLocalFailure` writes to admin_activity_logs.meta. */
export interface RecordedCreateFailure {
  message?: string | null;
  code?: string | null;
  constraint?: string | null;
  column?: string | null;
  table?: string | null;
  detail?: string | null;
  failedStatement?: string | null;
  stage?: string | null;
}

/**
 * One sentence for the operator. Names the SQLSTATE when it is one we have seen,
 * and falls back to the driver's own message rather than to a guess.
 */
export function explainCreateFailure(f: RecordedCreateFailure): string {
  const where = f.failedStatement ?? (f.stage ? `the ${f.stage} write` : 'the hub write');
  switch (f.code) {
    case '22001':
      return `A value was longer than its column allows (${f.message ?? '22001'}) during ${where}.`;
    case '23505':
      return f.constraint === 'orders_file_number_idx'
        ? 'The SoftPro sync imported this file before the hub create finished, so the hub could not add it again.'
        : `A row that should be unique already existed${f.constraint ? ` (${f.constraint})` : ''} during ${where}.`;
    case '23503':
      return `A linked record was missing${f.constraint ? ` (${f.constraint})` : ''} during ${where}.`;
    case '23502':
      return `A required value was empty${f.column ? ` (${f.column})` : ''} during ${where}.`;
    case null:
    case undefined:
    case '':
      // Rows recorded before 2026-09-14 read Drizzle's wrapper and carry no code.
      return `The reason was not recorded (the failure predates the recorder fix) — it failed during ${where}.`;
    default:
      return `Postgres ${f.code}${f.message ? `: ${f.message}` : ''} during ${where}.`;
  }
}

export interface CreateFailureAlertInput {
  orderId: number;
  fileNumber: string;
  address: string | null;
  failure: RecordedCreateFailure;
  operatorEmail: string | null;
  failedAt: Date;
}

export function buildCreateFailureAlertEmail(input: CreateFailureAlertInput): { subject: string; html: string } {
  const subject = `Hub order did not finish saving — ${input.fileNumber}`;
  const reason = explainCreateFailure(input.failure);
  const at = input.failedAt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

  const rows = [
    { label: 'File number', valueHtml: esc(input.fileNumber) },
    { label: 'Property', valueHtml: esc(input.address ?? 'Not saved — that is the problem') },
    { label: 'Entered by', valueHtml: esc(input.operatorEmail ?? 'Unknown') },
    { label: 'When', valueHtml: esc(at) },
    { label: 'Reason', valueHtml: esc(reason) },
  ];
  if (input.failure.code) {
    rows.push({
      label: 'Postgres',
      valueHtml: esc([input.failure.code, input.failure.column, input.failure.constraint].filter(Boolean).join(' · ')),
    });
  }

  const callout = '<strong>The file exists in SoftPro, and the hub order is missing its property.</strong> '
    + 'It has no address, so no title search has run and no documents will come. '
    + '<strong>Do not re-enter it</strong> — that creates a second SoftPro file. '
    + 'Open the order and press <em>Finish saving</em>.';

  const bodyHtml = [
    sectionLabel('Half-created order'),
    fieldTable(rows),
    calloutBar(callout),
    // ?order= takes the FILE NUMBER (orders-split-view.tsx), not the row id.
    `<div style="margin-top:26px;">${ctaButton('Open in the hub', `${APP_BASE_URL}/hub?order=${encodeURIComponent(input.fileNumber)}`)}</div>`,
  ].join('');

  return {
    subject,
    html: emailShell({
      title: subject,
      badge: 'Needs attention',
      preheader: `${input.fileNumber} is in SoftPro but did not finish saving in the hub.`,
      hero: {
        icon: '!',
        eyebrow: 'Create did not finish',
        headline: 'Order needs finishing',
        subcopy: 'SoftPro has the file. The hub is missing its property.',
      },
      bodyHtml,
    }),
  };
}
