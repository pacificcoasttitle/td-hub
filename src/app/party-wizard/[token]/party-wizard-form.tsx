'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RoleFormDefinition } from '@/lib/domain/parties/party-wizard-fields';

// ─── The form ────────────────────────────────────────────────────────────────
//
// Mobile-first: agents fill this on a phone between showings. Single column,
// 16px inputs (anything smaller makes iOS zoom on focus), 44px touch targets,
// and correct inputMode/autoComplete so the right keyboard appears.
//
// RESUME has two layers, because they solve different problems:
//   - previousValues comes from the last submission, so reopening the link on
//     ANY device shows what was sent before.
//   - a localStorage draft covers the commoner case: half-filled, distracted,
//     back an hour later on the same phone without having submitted anything.
// The draft is cleared on success so a later visit shows the submitted state.

interface Props {
  token: string;
  tokenId: string;
  form: RoleFormDefinition;
  previousValues: Record<string, string> | null;
  alreadySubmitted: boolean;
}

type Values = Record<string, string>;

function draftKey(tokenId: string): string {
  return `pw-draft:${tokenId}`;
}

export function PartyWizardForm({ token, tokenId, form, previousValues, alreadySubmitted }: Props) {
  // Seeded from the server (previousValues) so SSR and the first client render
  // agree. The localStorage draft is merged in after mount — see below.
  const [values, setValues] = useState<Values>(() => previousValues ?? {});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

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
      setDone(true);
    } catch {
      setFormError('We could not reach the server. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <h2 className="text-base font-semibold text-emerald-900">Thank you — we have your details</h2>
        <p className="mt-2 text-sm leading-relaxed text-emerald-800">
          They have been added to the file and your escrow officer has been notified.
          You can close this page.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6" noValidate>
      {alreadySubmitted && (
        <p className="mb-5 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900">
          You have already submitted details for this file. Changing anything below and
          submitting again will update them.
        </p>
      )}

      {form.sections.map((section) => (
        <fieldset key={section.title} className="mb-6 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold text-[#1B2A4A]">{section.title}</legend>
          {section.description && (
            <p className="mb-3 text-xs leading-relaxed text-slate-500">{section.description}</p>
          )}

          <div className="flex flex-col gap-4">
            {section.fields.map((field) => {
              const error = fieldErrors[field.key];
              return (
                <div key={field.key}>
                  <label
                    htmlFor={field.key}
                    className="mb-1.5 block text-sm font-medium text-slate-700"
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
                    className={`min-h-[44px] w-full rounded-lg border bg-white px-3 py-2.5 text-base text-[#1B2A4A] outline-none transition focus:ring-2 focus:ring-[#F26B2B]/40 ${
                      error ? 'border-red-400' : 'border-slate-300 focus:border-[#F26B2B]'
                    }`}
                  />
                  {field.hint && !error && (
                    <p className="mt-1 text-xs text-slate-400">{field.hint}</p>
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
        className="min-h-[48px] w-full rounded-lg bg-[#F26B2B] px-4 py-3 text-base font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Submitting…' : 'Submit details'}
      </button>

      <p className="mt-3 text-center text-xs leading-relaxed text-slate-400">
        Your progress is saved on this device as you type.
      </p>
    </form>
  );
}
