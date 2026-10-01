'use client';

import { useEffect, useRef, useState } from 'react';

// ─── Actions, collapsed ─────────────────────────────────────────────────────
//
// The Actions column was a row of text links — Download, Refresh document
// (free), Comparables, Notify rep — and the Refresh control carried a five-line
// explanatory paragraph INSIDE THE TABLE CELL. Between them they forced
// horizontal scroll on a seven-column fixed layout and tripled the row height,
// so roughly six reports fitted on a screen.
//
// ~350px of cell becomes a ~40px button, and the explanatory copy moves in here
// where a sentence is allowed to be a sentence. A table cell is not the place
// for body copy at any width.
//
// THE MENU IS NOT A SUBSTITUTE FOR THE ROW SAYING SOMETHING. What an operator
// needs at a glance — that a profile was made on an older layout, that a tax
// search is running — stays on the row as a badge. Only the CONTROLS move.
//
// Closing on pointerdown rather than click, for the same reason as the
// combobox: a click on a menu item must not be cancelled by the close that
// fires first.

export function RowMenu({ label = 'Actions', children }: {
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative inline-block text-left"
      // The row itself is clickable. A click anywhere in here is about the menu,
      // not about opening the report.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6B7280] hover:bg-gray-100 hover:text-[#1A1A2E] outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/40"
      >
        {/* Three dots, drawn rather than a glyph, so it cannot shift with fonts. */}
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="2.5" r="1.4" fill="currentColor" />
          <circle cx="7" cy="7" r="1.4" fill="currentColor" />
          <circle cx="7" cy="11.5" r="1.4" fill="currentColor" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-[272px] rounded-md border border-[#E5E5E5] bg-white p-1 text-left shadow-lg"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One row of the menu.
 *
 * `note` is where the copy that used to sit in the table cell lives. It is
 * allowed to wrap here, and it is only rendered when it has something to say —
 * a note on every item is a wall of text, which is the problem moved rather
 * than fixed.
 */
export function MenuItem({ label, note, tone, disabled, onSelect, href }: {
  label: string;
  note?: string | null;
  /** 'muted' for an item that is present but cannot act right now. */
  tone?: 'default' | 'muted' | 'danger';
  disabled?: boolean;
  onSelect?: () => void;
  /** Renders an anchor instead of a button — Download opens a PDF in a tab. */
  href?: string;
}) {
  const colour = tone === 'danger' ? 'text-[#8E2A1E]'
    : tone === 'muted' ? 'text-[#9AA0AA]'
    : 'text-[#1A1A2E]';
  const cls = `block w-full rounded px-2.5 py-[7px] text-left text-[12px] ${colour} `
    + (disabled ? 'cursor-default opacity-60' : 'hover:bg-[#F5F7FB] cursor-pointer');

  const body = (
    <>
      <span className="block font-medium">{label}</span>
      {note ? <span className="mt-[2px] block whitespace-normal text-[10.5px] leading-[1.35] text-[#6B7280]">{note}</span> : null}
    </>
  );

  if (href && !disabled) {
    return (
      <a role="menuitem" href={href} target="_blank" rel="noreferrer" className={cls}>
        {body}
      </a>
    );
  }
  return (
    <button role="menuitem" type="button" disabled={disabled} onClick={onSelect} className={cls}>
      {body}
    </button>
  );
}

/** A quiet marker on the row itself, for what the menu must not hide. */
export function RowBadge({ children, tone = 'grey' }: {
  children: React.ReactNode;
  tone?: 'grey' | 'amber' | 'green';
}) {
  const c = tone === 'amber' ? 'bg-[#FEF3EC] text-[#B4620B] border-[#F6D9C3]'
    : tone === 'green' ? 'bg-[#ECFDF3] text-[#0A7048] border-[#C7EBD8]'
    : 'bg-[#F4F5F7] text-[#6B7280] border-[#E5E7EB]';
  return (
    <span className={`ml-1.5 inline-block rounded border px-1 py-[1px] align-middle text-[9.5px] font-medium leading-[1.3] ${c}`}>
      {children}
    </span>
  );
}
