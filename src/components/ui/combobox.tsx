'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboboxItem {
  /** Stable identity. */
  key: string;
  /** What the list shows — already disambiguated by the caller. */
  label: string;
  /** Optional second line, for context the label should not carry. */
  detail?: string | null;
}

interface ComboboxProps {
  value: string;
  items: readonly ComboboxItem[];
  onPick: (item: ComboboxItem) => void;
  /** Free text, for fields where an unlisted value is legitimate. */
  onText?: (v: string) => void;
  placeholder?: string;
  id?: string;
  label?: string;
  /** Shown under the input when nothing matches. */
  emptyNote?: string;
  disabled?: boolean;
  className?: string;
}

// ─── Browse, then pick ──────────────────────────────────────────────────────
//
// The whole list on focus, filtered as you type. That is the shape of both
// jobs it does here: 54 sales reps, of whom an operator uses about eleven, and
// a prepared-for history that is short and personal.
//
// WHY NOT A <select>. Three reasons, and only the first is taste. The rep
// labels are disambiguated — "Kevin Cameron · #8821" — and a native select
// truncates them at exactly the part that distinguishes them. 54 is tolerable
// in a select and 150 is not, and this list grows. And the operator has just
// met this interaction on the address field two inches above, so it is one
// behaviour rather than two.
//
// FILTERING IS SUBSTRING, NOT PREFIX. People reach for a surname as readily as
// a first name, and a prefix match on "Cameron" finds nothing.

export function Combobox({
  value, items, onPick, onText, placeholder, id, label, emptyNote, disabled, className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (q === '') return items;
    return items.filter((i) => `${i.label} ${i.detail ?? ''}`.toLowerCase().includes(q));
  }, [items, value]);

  // Clamp rather than reset: the active row should survive a keystroke that
  // shortens the list, and an index past the end selects nothing on Enter.
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, filtered.length - 1))); }, [filtered.length]);

  // Close on a click anywhere else. Pointerdown, not click, so a pick on a row
  // is not cancelled by the close that a blur would fire first.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const choose = (item: ComboboxItem | undefined) => {
    if (!item) return;
    onPick(item);
    setOpen(false);
  };

  const base = 'w-full h-8 px-[9px] border border-[#E5E5E5] rounded-md text-[12px] outline-none '
    + 'focus:ring-1 focus:ring-brand-orange/30 focus:border-brand-orange disabled:bg-[#FAFAFB]';

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={label}
        autoComplete="off"
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        className={className ?? base}
        onFocus={() => setOpen(true)}
        onChange={(e) => { onText?.(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && open) { e.preventDefault(); choose(filtered[active]); }
          // stopPropagation so Escape closes the list and not the dialog
          // around it — the operator expects one step back, not two.
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
        }}
      />

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-[220px] w-full overflow-auto rounded-md border border-[#E5E5E5] bg-white shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-[11.5px] text-[#9AA0AA]">{emptyNote ?? 'No matches'}</li>
          ) : filtered.map((item, i) => (
            <li
              key={item.key}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => { e.preventDefault(); choose(item); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-[6px] text-[12px] ${i === active ? 'bg-[#FFF4EE] text-[#1A1F2B]' : 'text-[#3C4557]'}`}
            >
              {item.label}
              {item.detail ? <span className="ml-2 text-[10.5px] text-[#9AA0AA]">{item.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
