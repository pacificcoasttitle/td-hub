'use client';

import { useEffect, useState } from 'react';
import { Combobox } from '@/components/ui/combobox';
import type { RepOption } from '@/lib/domain/concierge/rep-options';

// ─── The presenting representative ──────────────────────────────────────────
//
// THE WHOLE LIST, BROWSABLE. Gerard's words were "all of the list so our user
// can easily select", and the control this replaces could not do that: it asked
// for two characters before it showed anything, so an operator who did not
// already know a rep's name had nothing to work from. There are 54 reps. A list
// that short should simply be readable.
//
// FETCHED ONCE PER OPEN, not per keystroke. /api/concierge/reps returns all 54
// in one query pair and filtering happens in the browser, so the debounce, the
// request counter and the "Searching…" state are all gone. None of them were
// buying anything against a list this size.
//
// TWO MODES, DELIBERATELY. Browsing, and then chosen-with-a-Change-button. A
// rep must be a real contact id — the document prints their name, phone and
// email — so this field never accepts free text, and the chosen state is what
// makes it impossible for the id and the displayed name to drift apart. The
// prepared-for field next door is the opposite case and does accept free text.

export function RepCombobox({ chosenName, onChoose, onClear }: {
  chosenName: string;
  onChoose: (r: RepOption) => void;
  onClear: () => void;
}) {
  const [reps, setReps] = useState<RepOption[] | null>(null);
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/concierge/reps')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { reps?: RepOption[] }) => { if (!cancelled) setReps(d.reps ?? []); })
      .catch(() => { if (!cancelled) { setReps([]); setFailed(true); } });
    return () => { cancelled = true; };
  }, []);

  if (chosenName) {
    return (
      <div className="flex items-center justify-between rounded-md border border-[#E5E5E5] px-3 py-2">
        <span className="text-[12px] text-[#171717]">{chosenName}</span>
        <button
          type="button"
          onClick={() => { onClear(); setQuery(''); }}
          className="text-[11px] font-medium text-[#1B2A4A] hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <Combobox
        label="Presenting representative"
        value={query}
        onText={setQuery}
        items={(reps ?? []).map((r) => ({ key: String(r.id), label: r.label, detail: r.detail ?? null }))}
        onPick={(item) => {
          const rep = reps?.find((r) => String(r.id) === item.key);
          if (rep) { onChoose(rep); setQuery(''); }
        }}
        placeholder={reps === null ? 'Loading representatives…' : 'Select or type to filter'}
        emptyNote={failed
          ? 'The representative list could not be loaded — reopen the dialog to try again.'
          : 'No sales representative by that name.'}
        disabled={reps === null}
      />
      {/* A failure here BLOCKS THE GENERATE, because draftProblem() requires a
          rep id. Saying so beats an empty list the operator reads as "there are
          none" — and it must not be mistaken for a reason to let the profile go
          out with no presenting rep. */}
      {failed ? (
        <p className="mt-1 text-[10.5px] text-[#B45309]">
          The representative list could not be loaded. Close and reopen the dialog — a profile
          cannot be generated without a representative.
        </p>
      ) : null}
    </div>
  );
}
