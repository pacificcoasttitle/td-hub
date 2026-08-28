'use client';

import { isValidDeliverableEmail, MAX_DELIVERABLE_EMAILS } from '@/lib/domain/notifications/deliverable-emails-validation';

// ─── Deliverable emails, on the open-order form ─────────────────────────────
//
// THE HELPER TEXT SAYS ONLY WHAT THE CODE DOES. Today that is the order
// confirmation and nothing else. An earlier draft read "and on documents sent
// for this order", which would have been a promise the code does not keep —
// the same defect class this field was removed for in the first place, where
// the form collected addresses and nothing read them.
//
// When the prelim and document paths are wired, this string changes in step.
// See docs/tickets/DELIVERABLE_EMAILS.md.

export interface DeliverableEmailsFieldProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Set on the create form; the post-open editor renders its own heading. */
  showHeading?: boolean;
}

export function DeliverableEmailsField({
  value, onChange, showHeading = true,
}: DeliverableEmailsFieldProps) {
  const used = value.filter((e) => e.trim() !== '').length;
  const canAdd = value.length < MAX_DELIVERABLE_EMAILS;

  const update = (i: number, v: string) => {
    const next = [...value];
    next[i] = v;
    onChange(next);
  };

  return (
    <div>
      {showHeading && (
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            Deliverable Emails
          </p>
          {canAdd && (
            <button
              type="button"
              onClick={() => onChange([...value, ''])}
              className="text-xs font-medium text-[#F26B2B] hover:text-[#E05A1A] min-h-[36px]"
            >
              + Add
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {value.map((em, i) => {
          // Only flag a line the operator has actually typed into. An empty
          // trailing row is how you add the next one, not a mistake.
          const bad = em.trim() !== '' && !isValidDeliverableEmail(em);
          return (
            <div key={i}>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={em}
                  onChange={(e) => update(i, e.target.value)}
                  placeholder="email@example.com"
                  className={`flex-1 h-10 px-3 rounded-lg text-sm outline-none border ${
                    bad
                      ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-1 focus:ring-red-200'
                      : 'border-gray-200 bg-white focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20'
                  }`}
                />
                <button
                  type="button"
                  aria-label="Remove email"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  className="text-red-500 px-2 min-h-[36px]"
                >
                  ×
                </button>
              </div>
              {bad && (
                <p className="mt-1 text-[11.5px] text-red-600">Enter a valid email address.</p>
              )}
            </div>
          );
        })}
      </div>

      {value.length === 0 && canAdd && (
        <button
          type="button"
          onClick={() => onChange([''])}
          className="text-xs font-medium text-[#F26B2B] hover:text-[#E05A1A] min-h-[36px]"
        >
          + Add an address
        </button>
      )}

      <p className="mt-2 text-[11.5px] text-[#6B7280] leading-snug">
        Copied on the order confirmation. Up to {MAX_DELIVERABLE_EMAILS}. You can change this later
        from the order.
      </p>
      {used > 0 && (
        <p className="mt-1 text-[11.5px] text-[#9AA0AA]">
          {used} of {MAX_DELIVERABLE_EMAILS} used
        </p>
      )}
    </div>
  );
}
