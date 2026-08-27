'use client';

import { useState } from 'react';
import type { OrderNote } from './use-order-extras';

// ─── Notes: a strip, not a section ──────────────────────────────────────────
//
// order_notes holds ONE row in the entire database, across one order out of
// 8,036. A notes panel with a header and a body would be an empty rectangle on
// every order anyone opens — the same wasted third of the pane this layout
// exists to remove, just relocated.
//
// So it is a single row that costs one line when empty, lists the notes when
// there are any, and expands to a composer on click. If notes ever get used,
// this grows into the space on its own and can be promoted then.

export interface NotesStripProps {
  notes: OrderNote[];
  loading: boolean;
  saving: boolean;
  onAdd: (text: string) => void;
}

export function NotesStrip({ notes, loading, saving, onAdd }: NotesStripProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const submit = () => {
    const t = text.trim();
    if (!t || saving) return;
    onAdd(t);
    setText('');
    setOpen(false);
  };

  return (
    <section className="bg-white border border-[#EEF0F4] rounded-[9px]">
      <header className="h-7 flex items-center justify-between px-[13px]">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A94A6]">
          Notes
          {!loading && notes.length > 0 && (
            <span className="ml-[6px] tabular-nums font-normal tracking-normal">{notes.length}</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] font-semibold text-brand-orange hover:text-brand-orange-hover outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30 rounded-[4px] px-[4px]"
        >
          {open ? 'Cancel' : 'Add a note'}
        </button>
      </header>

      {(notes.length > 0 || open) && (
        <div className="px-[13px] pb-[9px] border-t border-[#EEF0F4] pt-[8px]">
          {notes.length > 0 && (
            <ul className="flex flex-col gap-[7px] mb-[8px]">
              {notes.slice(0, 5).map((n) => (
                <li key={n.id} className="text-[12px] text-[#1B2A4A] leading-[1.45]">
                  {n.subject && <span className="font-semibold">{n.subject} — </span>}
                  {n.body}
                  <span className="text-[10.5px] text-[#8A94A6] ml-[6px]">
                    {n.authorName ?? 'Unknown'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {open && (
            <div className="flex gap-2 items-start">
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                // Enter submits, Shift+Enter is a newline. This is a one-line
                // note field, not a document editor.
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                  if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
                }}
                rows={2}
                placeholder="Note for this order"
                className="flex-1 px-[9px] py-[6px] border border-[#EEF0F4] rounded-md text-[12px] text-[#1B2A4A] outline-none resize-none focus:ring-1 focus:ring-brand-orange/30 focus:border-brand-orange"
              />
              <button
                type="button"
                onClick={submit}
                disabled={saving || text.trim() === ''}
                className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold bg-brand-orange text-white hover:bg-brand-orange-hover disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
