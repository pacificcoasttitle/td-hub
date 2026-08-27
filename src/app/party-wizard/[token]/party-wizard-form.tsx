'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RoleFormDefinition } from '@/lib/domain/parties/party-wizard-fields';
import type { WizardOrderContext } from '@/lib/domain/parties/party-wizard-service';
import { ConfirmationLine } from '@/components/party-wizard/confirmation-line';
import { LegitimacyHeader } from '@/components/party-wizard/legitimacy-header';
import { NextSteps, StatusPanel } from '@/components/party-wizard/status-panel';

// ─── The form ────────────────────────────────────────────────────────────────
//
// Mobile-first: agents fill this on a phone between showings. Single column,
// 16px inputs (anything smaller makes iOS zoom on focus), 44px touch targets,
// and correct inputMode/autoComplete so the right keyboard appears. Those
// numbers are load-bearing and have not changed — only the border and focus
// colours moved onto the dashboard palette.
//
// RESUME has two layers, because they solve different problems:
//   - previousValues comes from the last submission, so reopening the link on
//     ANY device shows what was sent before.
//   - a localStorage draft covers the commoner case: half-filled, distracted,
//     back an hour later on the same phone without having submitted anything.
// The draft is cleared on success so a later visit shows the submitted state.
//
// THREE VIEWS, not one. A visitor returning to a link they already used sees a
// read-only summary of what they sent, not a prefilled form — a prefilled form
// looks exactly like a form that was never received, and the natural response
// to that is to fill it in again or to give up.

const LIGHT_CARD =
  'rounded-[18px] border border-[#10213A]/[0.07] bg-white shadow-[0_14px_40px_-24px_rgba(16,33,58,0.45)]';

const INPUT_BASE =
  'min-h-[44px] w-full rounded-lg border bg-white px-3 py-2.5 text-base text-[#1B2A4A] outline-none transition focus:ring-2 focus:ring-[#F26B2B]/40';

interface Props {
  token: string;
  tokenId: string;
  form: RoleFormDefinition;
  previousValues: Record<string, string> | null;
  alreadySubmitted: boolean;
  /** "Representing" — how this role's counterpart is introduced. */
  counterpartLabel: string;
  /**
   * The branded header renders from in here rather than from the page, because
   * its eyebrow has to follow the view. Submitting is a client-side transition,
   * so a header owned by the server would still be saying "Action required"
   * directly above "Thank you — we have your details".
   */
  context: WizardOrderContext;
}

type Values = Record<string, string>;
type View = 'form' | 'summary' | 'submitted';

/**
 * The hero badge, per view.
 *
 * "Action required" is the email's own badge (party-wizard-email.ts:111) and is
 * the reason to keep one at all — it is the line the recipient read moments ago.
 * It just must not survive into the states where nothing is required.
 */
const EYEBROW: Record<View, string> = {
  form: 'Action required',
  summary: 'Already received',
  submitted: 'Received',
};

const NUMBER_WORDS = ['no', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/**
 * The size of the ask, counted from the form definition rather than asserted.
 *
 * A time estimate that is wrong is worse than none, and one that drifts when
 * somebody adds a field is the same thing on a delay. The optional block has a
 * description of its own and is excluded here, because it is not part of what
 * we are asking them to do.
 */
function askScope(form: RoleFormDefinition): string {
  const required = form.sections[0]?.fields.length ?? 0;
  const word = NUMBER_WORDS[required] ?? String(required);
  return `${word} field${required === 1 ? '' : 's'}, about a minute.`;
}

function draftKey(tokenId: string): string {
  return `pw-draft:${tokenId}`;
}

export function PartyWizardForm({
  token, tokenId, form, previousValues, alreadySubmitted, counterpartLabel, context,
}: Props) {
  const counterpartName = context.counterpartName;
  // Seeded from the server (previousValues) so SSR and the first client render
  // agree. The localStorage draft is merged in after mount — see below.
  const [values, setValues] = useState<Values>(() => previousValues ?? {});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<View>(alreadySubmitted ? 'summary' : 'form');

  // Restore a local draft, but never let it overwrite an actual submission.
  //
  // This reads a client-only store (localStorage) that cannot exist during SSR,
  // so it has to happen after mount: seeding it in the useState initializer
  // would make the server and client renders disagree and break hydration.
  // That is precisely the "sync state in from an external system" case the
  // set-state-in-effect rule cannot distinguish, so it is disabled here rather
  // than worked around in a way that would reintroduce the mismatch.
  useEffect(() => {
    if (previousValues) return;
    let draft: Values | null = null;
    try {
      const raw = window.localStorage.getItem(draftKey(tokenId));
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object') draft = parsed as Values;
      }
    } catch {
      // A corrupt or unreadable draft is not worth surfacing; start clean.
    }
    if (!draft) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from a client-only store
    setValues((cur) => (Object.keys(cur).length ? cur : draft));
  }, [tokenId, previousValues]);

  const setField = useCallback((key: string, value: string) => {
    setValues((cur) => {
      const next = { ...cur, [key]: value };
      try {
        window.localStorage.setItem(draftKey(tokenId), JSON.stringify(next));
      } catch {
        // Private mode or a full quota — typing must still work.
      }
      return next;
    });
    setFieldErrors((cur) => (cur[key] ? { ...cur, [key]: '' } : cur));
  }, [tokenId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const res = await fetch(`/api/party-wizard/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; fieldErrors?: Record<string, string>;
      };

      if (!res.ok || !data.ok) {
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        setFormError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }

      try {
        window.localStorage.removeItem(draftKey(tokenId));
      } catch { /* nothing to clean up */ }
      setView('submitted');
    } catch {
      setFormError('We could not reach the server. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <LegitimacyHeader
      context={context}
      headline={view === 'form' ? form.heading : 'Listing agent details'}
      eyebrow={EYEBROW[view]}
    />
  );

  if (view === 'submitted') {
    return <>{header}<SubmittedPanel /></>;
  }

  if (view === 'summary') {
    return (
      <>
        {header}
        <SubmittedSummary form={form} values={values} onEdit={() => setView('form')} />
      </>
    );
  }

  return (
    <>
    {header}
    <form onSubmit={onSubmit} className={`${LIGHT_CARD} mt-4 px-5 py-6 sm:px-7`} noValidate>
      <p className="text-sm leading-relaxed text-[#4B5563]">{form.intro}</p>
      <p className="mt-2 text-sm font-semibold text-[#10213A]">{askScope(form)}</p>

      <div className="my-5 h-px w-full bg-[#10213A]/[0.07]" />

      {counterpartName && (
        <ConfirmationLine
          label={counterpartLabel}
          name={counterpartName}
          flagged={values.counterpartFlagged === 'true'}
          onToggle={(next) => setField('counterpartFlagged', next ? 'true' : '')}
        />
      )}

      {form.sections.map((section) => (
        <fieldset key={section.title} className="mb-6 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold text-[#10213A]">{section.title}</legend>
          {section.description && (
            <p className="mb-3 text-xs leading-relaxed text-[#6B7280]">{section.description}</p>
          )}

          <div className="flex flex-col gap-4">
            {section.fields.map((field) => {
              const error = fieldErrors[field.key];
              return (
                <div key={field.key}>
                  <label
                    htmlFor={field.key}
                    className="mb-1.5 block text-sm font-medium text-[#1A1A2E]"
                  >
                    {field.label}
                    {field.required && <span className="ml-1 text-[#F26B2B]">*</span>}
                  </label>
                  <input
                    id={field.key}
                    name={field.key}
                    type={field.type}
                    inputMode={field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : 'text'}
                    autoComplete={field.autoComplete}
                    placeholder={field.placeholder}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${field.key}-error` : undefined}
                    /* text-base = 16px; anything smaller makes iOS zoom on focus */
                    className={`${INPUT_BASE} ${
                      error ? 'border-red-400' : 'border-[#10213A]/15 focus:border-[#F26B2B]'
                    }`}
                  />
                  {field.hint && !error && (
                    <p className="mt-1 text-xs text-[#6B7280]">{field.hint}</p>
                  )}
                  {error && (
                    <p id={`${field.key}-error`} className="mt-1 text-xs text-red-600">{error}</p>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      {formError && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="min-h-[48px] w-full rounded-lg bg-[#F26B2B] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#E05A1A] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Submitting…' : 'Submit details'}
      </button>

      {/* Naming what we will never ask for is the cheapest signal on the page,
          and the one a cautious reader is looking for without knowing it. */}
      <p className="mt-4 text-center text-xs leading-relaxed text-[#6B7280]">
        We will never ask you for a bank account, a wire instruction, or a password.
        <br />
        Your progress is saved on this device as you type.
      </p>
    </form>
    </>
  );
}

/**
 * The moment after they hit submit. No CTA — there is nothing else we want
 * from them, and offering an action here would imply there is.
 *
 * Exported so the test can assert what it says, rather than the test rebuilding
 * the same panel from the same strings and proving only that strings equal
 * themselves.
 */
export function SubmittedPanel() {
  return (
    <StatusPanel
      tone="done"
      title="Thank you — we have your details"
      body="They are on the file now. You can close this page."
    >
      <NextSteps />
    </StatusPanel>
  );
}

/**
 * What a returning visitor sees.
 *
 * Read-only and explicit that it arrived, because the alternative — the live
 * prefilled form this used to render under a small blue banner — is
 * indistinguishable from a form that was never received.
 */
export function SubmittedSummary({
  form, values, onEdit,
}: {
  form: RoleFormDefinition;
  values: Values;
  onEdit: () => void;
}) {
  const rows = form.sections
    .flatMap((s) => s.fields)
    .map((f) => ({ label: f.label, value: values[f.key]?.trim() }))
    .filter((r): r is { label: string; value: string } => Boolean(r.value));

  return (
    <StatusPanel
      tone="done"
      title="You have already sent these details"
      body="They are on the file. There is nothing further to do unless something below has changed."
    >
      {rows.length > 0 && (
        <dl className="mt-4 divide-y divide-[#10213A]/[0.07] border-t border-[#10213A]/[0.07]">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-sm text-[#6B7280]">{row.label}</dt>
              <dd className="break-words text-sm font-medium text-[#10213A] sm:text-right">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <button
        type="button"
        onClick={onEdit}
        className="mt-5 min-h-[44px] w-full rounded-lg border border-[#10213A]/15 bg-white px-4 py-2.5 text-sm font-semibold text-[#10213A] transition hover:bg-[#F5F6FA]"
      >
        Update these details
      </button>
    </StatusPanel>
  );
}
