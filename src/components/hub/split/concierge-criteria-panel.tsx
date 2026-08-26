'use client';

import { useState } from 'react';
import type { CompCriteria } from '@/lib/domain/concierge/comp-filter';
import type { ProfileSummary } from '@/lib/domain/concierge/profiles';

// ─── Adjusting comparables — free, on an ISSUED profile ─────────────────────
//
// This panel exists because the criteria are OURS. SiteX returns the
// comparables; we rank and filter them. So moving a slider is arithmetic on
// data already bought, and the operator can do it as often as they like without
// re-running anything.
//
// That is why it lives HERE, on the issued profile, and not in the flow before
// the spend. Criteria before the cost gate would read as though they shape the
// vendor call. They do not, and drawing them there once was a mistake.
//
// Every control says "free" and the submit button says "Re-render", not
// "Generate" — nothing on this panel may look like it costs anything.

const FREE_NOTE = 'Free — the comparables are already stored.';

/**
 * MOUNTED ONLY WHILE OPEN, so the sliders always start from the criteria the
 * profile currently carries rather than from a stale copy taken at first mount.
 */
export function ConciergeCriteriaPanel({
  profile, busy, error, onClose, onApply,
}: {
  profile: ProfileSummary;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (c: CompCriteria) => void;
}) {
  const [c, setC] = useState<CompCriteria>(profile.criteria);

  const set = <K extends keyof CompCriteria>(k: K, v: CompCriteria[K]) => setC({ ...c, [k]: v });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby="criteria-title"
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); } }}
    >
      <div className="bg-white rounded-[10px] w-full max-w-[560px] shadow-xl border border-[#E5E5E5]">
        <div className="px-5 py-4 border-b border-[#F0F1F3]">
          <h2 id="criteria-title" className="text-[15px] font-semibold text-[#171717]">
            Adjust comparables
          </h2>
          <p className="text-[11.5px] text-[#6B7280] mt-[3px]">
            {FREE_NOTE} Changing these re-renders the document and never calls SiteX.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="rounded-md bg-[#FAFAFB] border border-[#EDEFF3] px-3 py-2 text-[11.5px] text-[#3C4557] tabular-nums">
            SiteX returned <strong>{profile.compsReturned}</strong> ·
            {' '}<strong>{profile.compsQualified}</strong> qualified ·
            {' '}<strong>{profile.compsShown}</strong> shown
          </div>

          <Toggle
            label="Same property type only"
            checked={c.sameUseCode}
            onChange={(v) => set('sameUseCode', v)}
          />
          <Slider label="Living area within" unit="%" value={c.livingAreaPct} min={0} max={200} step={5}
            onChange={(v) => set('livingAreaPct', v)} />
          <Slider label="Bedrooms within" unit="" value={c.bedDelta} min={0} max={5} step={1}
            onChange={(v) => set('bedDelta', v)} />
          <Slider label="Bathrooms within" unit="" value={c.bathDelta} min={0} max={5} step={1}
            onChange={(v) => set('bathDelta', v)} />
          <Slider label="Radius" unit=" mi" value={c.radiusMiles} min={0} max={10} step={0.25}
            onChange={(v) => set('radiusMiles', v)} />
          <Slider label="Sold within" unit=" months" value={c.months} min={1} max={60} step={1}
            onChange={(v) => set('months', v)} />
          <Slider label="Show at most" unit="" value={c.maxComps} min={1} max={30} step={1} required
            onChange={(v) => set('maxComps', v ?? 12)} />

          {/* The count is a CEILING, not a quota. The document shows fewer when
              fewer qualify, and never pads to reach the number. */}
          <p className="text-[10px] text-[#9AA0AA]">
            A maximum, not a target — the document shows fewer when fewer qualify and never pads.
          </p>

          {error && (
            <p className="text-[11.5px] text-[#8E2A1E] bg-[#FDECEA] border border-[#F2C4BD] rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#F0F1F3] flex items-center justify-between gap-2">
          <span className="text-[10.5px] text-[#0A7048]">{FREE_NOTE}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy}
              className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold border border-[#E5E5E5] bg-white text-[#3C4557] hover:bg-[#FAFAFB] disabled:opacity-50">
              Close
            </button>
            <button type="button" onClick={() => onApply(c)} disabled={busy}
              className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold bg-brand-orange text-white hover:bg-brand-orange-hover disabled:opacity-40">
              {busy ? 'Re-rendering…' : 'Re-render — free'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="w-[14px] h-[14px] rounded border-gray-300 text-brand-orange" />
      <span className="text-[12px] text-[#3C4557]">{label}</span>
    </label>
  );
}

/**
 * `null` means the filter is not applied at all, which is different from 0 —
 * a radius of 0 miles would exclude everything, while no radius means distance
 * is not a criterion. The "Any" checkbox is how that is expressed.
 */
function Slider({
  label, unit, value, min, max, step, required, onChange,
}: {
  label: string; unit: string; value: number | null;
  min: number; max: number; step: number; required?: boolean;
  onChange: (v: number | null) => void;
}) {
  const off = value === null;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11.5px] text-[#3C4557] w-[130px] shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step}
        value={off ? min : value}
        disabled={off}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[#F26B2B] disabled:opacity-40"
      />
      <span className="text-[11.5px] text-[#171717] tabular-nums w-[74px] text-right">
        {off ? 'Any' : `${value}${unit}`}
      </span>
      {!required && (
        <label className="flex items-center gap-1 text-[10px] text-[#6B7280] cursor-pointer select-none w-[42px]">
          <input type="checkbox" checked={off} onChange={(e) => onChange(e.target.checked ? null : min)}
            className="w-[12px] h-[12px] rounded border-gray-300 text-brand-orange" />
          Any
        </label>
      )}
    </div>
  );
}
