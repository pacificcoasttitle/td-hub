'use client';

/**
 * The presentation shared by every contact picker on the open-order form.
 *
 * The client selector owned this markup first. The parties section now renders
 * the same search box, the same dropdown row and the same resolved card, so the
 * two sections cannot drift apart in spacing or tone — which is the whole point
 * of pulling it out here rather than writing a second treatment.
 */

/** Street + city for picker display. Empty string when nothing useful — never an em-dash. */
export function formatContactAddress(
  c: { address?: string | null; city?: string | null } | null | undefined,
): string {
  if (!c) return '';
  const street = c.address?.trim() || '';
  const city = c.city?.trim() || '';
  if (street && city) return `${street}, ${city}`;
  return street || city;
}

/** First non-blank candidate's initial, for the avatar. */
export function contactInitial(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const t = c?.trim();
    if (t) return t.charAt(0).toUpperCase();
  }
  return '?';
}

/** The middot-joined identity line both pickers use. */
export function joinIdentity(parts: Array<string | null | undefined>): string {
  return parts.map((p) => p?.trim()).filter(Boolean).join(' · ');
}

export function ContactSearchInput({
  value,
  onChange,
  onFocus,
  placeholder,
  searching,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  placeholder: string;
  searching?: boolean;
}) {
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
      {searching && (
        <svg className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#F26B2B] animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/40 focus:border-[#F26B2B] bg-white"
      />
    </div>
  );
}

/**
 * The neutral grey line a picker uses to state a consequence in place of a
 * control.
 *
 * Deliberately not amber and not red. Most party slots are legitimately empty on
 * a normal order, and a form that shows five warnings on a normal order teaches
 * operators to ignore warnings. Shared so the parties section and the client
 * selector cannot drift into two tones for the same kind of statement.
 */
export function ContactNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1.5 flex items-start gap-1.5 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
      <svg className="h-3.5 w-3.5 text-[#6B7280] shrink-0 mt-px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p className="text-xs text-[#6B7280]">{children}</p>
    </div>
  );
}

export function ContactDropdown({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
      {children}
    </div>
  );
}

export function ContactDropdownMessage({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-4 text-sm text-[#6B7280] text-center">{children}</div>;
}

/** One hit in the dropdown. */
export function ContactResultButton({
  initial,
  title,
  detail,
  subDetail,
  badge,
  disabled,
  onClick,
}: {
  initial: string;
  title: string;
  detail: string;
  subDetail?: string;
  badge?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:bg-gray-50'}`}
    >
      <div className="flex items-center gap-3">
        <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${disabled ? 'bg-gray-200' : 'bg-[#1B2A4A]/10'}`}>
          <span className={`text-xs font-bold ${disabled ? 'text-gray-400' : 'text-[#1B2A4A]'}`}>{initial}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium break-words sm:truncate ${disabled ? 'text-gray-400' : 'text-[#1A1A2E]'}`}>{title}</p>
          <p className="text-xs text-[#6B7280] break-words sm:truncate">{detail}</p>
          {!disabled && subDetail ? (
            <p className="text-xs text-[#6B7280] break-words sm:truncate mt-0.5">{subDetail}</p>
          ) : null}
        </div>
        {badge && (
          <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded ${disabled ? 'bg-red-50 text-red-400' : 'bg-gray-100 text-[#6B7280]'}`}>
            {badge}
          </span>
        )}
      </div>
    </button>
  );
}

/** The read-only card shown once a contact is resolved. */
export function ResolvedContactCard({
  initial,
  title,
  detail,
  subDetail,
  actionLabel = 'Change',
  onAction,
}: {
  initial: string;
  title: string;
  detail: string;
  subDetail?: string;
  actionLabel?: string;
  onAction: () => void;
}) {
  return (
    <div className="bg-[#1B2A4A]/5 border border-[#1B2A4A]/15 rounded-lg px-4 py-3">
      {/* Stacks below sm: at 390px a row layout leaves so little width that the
          identity line truncates to "Pacific Shores …", which is the opposite
          of what this card is for. */}
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-full bg-[#1B2A4A] flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">{initial}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#1A1A2E] break-words sm:truncate">{title}</p>
            <p className="text-xs text-[#6B7280] break-words sm:truncate">{detail}</p>
            {subDetail ? <p className="text-xs text-[#6B7280] break-words sm:truncate mt-0.5">{subDetail}</p> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onAction}
          className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-[#6B7280] border border-gray-200 rounded-lg hover:bg-white hover:text-[#1A1A2E] transition-colors"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
