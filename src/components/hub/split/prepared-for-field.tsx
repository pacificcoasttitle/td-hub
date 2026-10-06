'use client';

import { useEffect, useRef, useState } from 'react';
import { Combobox } from '@/components/ui/combobox';
import type { PreparedForSuggestion } from '@/lib/domain/concierge/prepared-for';

// ─── Prepared for ───────────────────────────────────────────────────────────
//
// FREE TEXT FIRST, suggestions second — the opposite of the rep field. A rep
// must be one of 54 contact ids; a prepared-for name is whoever the operator is
// sending this to, and a new client has to be typeable without fighting a
// picker. So the input IS the field: what is typed is what is stored, and
// picking a suggestion is a shortcut, never a requirement.
//
// THE SUGGESTIONS ARE THE OPERATOR'S OWN HISTORY, not the contact book.
// Autocompleting from `contacts` was the obvious idea and it does not work: all
// six prepared-for names on existing profiles match no contact at all. See
// prepared-for.ts for why, and for why this is ranked by frequency before
// recency and scoped to one operator.
//
// PICKING A NAME ALSO FILLS THE BROKERAGE, because the two travel together and
// retyping the second one is the kind of friction that makes people skip it.
// Typing the name by hand leaves the brokerage alone.

export function PreparedForField({
  name, company, onName, onCompany,
}: {
  name: string;
  company: string;
  onName: (v: string) => void;
  onCompany: (v: string) => void;
}) {
  const [items, setItems] = useState<PreparedForSuggestion[]>([]);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reqRef = useRef(0);

  // Debounced, unlike the rep list — this one is a query against the operator's
  // profile history, so it cannot be fetched once and filtered in the browser.
  useEffect(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => {
      const id = ++reqRef.current;
      fetch(`/api/concierge/prepared-for?q=${encodeURIComponent(name.trim())}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d: { results?: PreparedForSuggestion[] }) => {
          if (id === reqRef.current) setItems(d.results ?? []);
        })
        // Silent. A suggestion list that cannot load costs nothing: the field
        // still works, because the field is the input.
        .catch(() => { if (id === reqRef.current) setItems([]); });
    }, 200);
    return () => clearTimeout(debRef.current);
  }, [name]);

  const input = 'w-full h-8 px-[9px] border border-[#E5E5E5] rounded-md text-[12px] outline-none '
    + 'focus:ring-1 focus:ring-brand-orange/30 focus:border-brand-orange';

  return (
    <div>
      <label className="block text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[#9AA0AA] mb-1">
        Prepared for
      </label>
      <Combobox
        label="Prepared for"
        value={name}
        onText={onName}
        items={items.map((s) => ({
          key: s.name,
          label: s.name,
          // The count is the ranking made visible — it is why this name is at
          // the top, and it tells a typo from a client at a glance.
          // "Used by the team" distinguishes somebody else's client from your
          // own, which matters now the list is pooled: the count is no longer
          // a statement about you. Your own entries say nothing extra — they
          // are already at the top, and labelling the common case is noise.
          detail: [
            s.company,
            s.used > 1 ? `${s.used} profiles` : null,
            s.mine ? null : 'used by the team',
          ].filter(Boolean).join(' · ') || null,
        }))}
        onPick={(item) => {
          onName(item.key);
          const hit = items.find((s) => s.name === item.key);
          if (hit?.company) onCompany(hit.company);
        }}
        placeholder="Client or agent name"
        emptyNote="No earlier profile for that name — type it in full."
        className={input}
      />
      <input
        value={company}
        onChange={(e) => onCompany(e.target.value)}
        placeholder="Brokerage (optional)"
        className={`${input} mt-[6px]`}
        aria-label="Brokerage"
      />
    </div>
  );
}
