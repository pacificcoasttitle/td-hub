'use client';

// ─── The counterpart confirmation ────────────────────────────────────────────
//
// This line is not disclosure — it is a checksum the recipient can run in one
// glance. A listing agent already knows who their seller is, so seeing the name
// proves they are on the right file. And when it is WRONG they will say so,
// which is data-quality feedback on SiteX owner parsing that we can get no
// other way.
//
// So "not correct?" has to be a real control and not decoration. It rides out
// with the submission rather than opening a mail client, because an agent who
// has to compose an email will simply not bother.
//
// Warm pill palette is the dashboard's, from
// src/components/sales/dashboard-content.tsx:169.

export function ConfirmationLine({
  label, name, flagged, onToggle,
}: {
  label: string;
  name: string;
  flagged: boolean;
  onToggle: (next: boolean) => void;
}) {
  if (flagged) {
    return (
      <div className="mb-5 rounded-xl border border-[#FBE0BF] bg-[#FFF4E4] px-4 py-3">
        <p className="text-sm leading-relaxed text-[#B4621F]">
          <span className="font-semibold">Thanks — we will check that.</span>{' '}
          Flagged with your submission. Nothing else to do.
        </p>
        <button
          type="button"
          onClick={() => onToggle(false)}
          className="mt-1 text-xs font-medium text-[#B4621F] underline underline-offset-2"
        >
          Actually, {name} is correct
        </button>
      </div>
    );
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-[#FBE0BF] bg-[#FFF4E4] px-4 py-3">
      <p className="text-sm text-[#B4621F]">
        {label} <span className="font-semibold">{name}</span>
      </p>
      <button
        type="button"
        onClick={() => onToggle(true)}
        className="text-sm font-medium text-[#B4621F] underline underline-offset-2 transition-opacity hover:opacity-70"
      >
        not correct?
      </button>
    </div>
  );
}
