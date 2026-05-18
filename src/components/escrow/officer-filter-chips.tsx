'use client';

import { useEffect, useMemo, useState } from 'react';

export type OfficerFilterValue = number | null | 'unassigned';

export interface OfficerOption {
  id: number;
  name: string;
}

/** Used only when GET /api/escrow/officers returns 404 (temporary roster). */
const OFFICERS_404_FALLBACK: OfficerOption[] = [
  { id: 13, name: 'Christine Quintanar' },
  { id: 10999, name: 'Joseph Gomez' },
  { id: 8996, name: 'Lupe Vidaca' },
  { id: 17165, name: 'Anna Ballesteros' },
  { id: 10642, name: 'Karla Casco' },
];

export interface OfficerFilterChipsProps {
  activeOfficerId: OfficerFilterValue;
  onChange: (officerId: OfficerFilterValue) => void;
}

export function OfficerFilterChips({ activeOfficerId, onChange }: OfficerFilterChipsProps) {
  const [officers, setOfficers] = useState<OfficerOption[]>([]);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch('/api/escrow/officers')
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled) {
            setOfficers(OFFICERS_404_FALLBACK);
            setFallbackUsed(true);
          }
          return;
        }
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const d = (await r.json()) as { officers?: Array<{ id: number; name: string }> };
        const list = (d.officers ?? []).map((o) => ({
          id: o.id,
          name: String(o.name ?? '').trim() || '—',
        }));
        if (!cancelled) {
          setOfficers(list);
          setFallbackUsed(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Failed to load officers');
          setOfficers([]);
          setFallbackUsed(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const sorted = useMemo(
    () => [...officers].sort((a, b) => a.name.localeCompare(b.name)),
    [officers],
  );

  function chipClass(active: boolean): string {
    return [
      'px-3 py-1 rounded-full text-xs font-medium transition-colors',
      active
        ? 'bg-[#1B2A4A] text-white'
        : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
    ].join(' ');
  }

  const allActive = activeOfficerId === null;
  const unassignedActive = activeOfficerId === 'unassigned';

  return (
    <div className="px-4 pt-3 shrink-0">
      {fallbackUsed && (
        <p className="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5" role="status">
          Officer list unavailable (API 404); using roster fallback. Confirm with Builder that GET /api/escrow/officers is deployed.
        </p>
      )}
      {loadError && officers.length === 0 && (
        <p className="mb-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md px-2 py-1.5" role="alert">
          Could not load officers: {loadError}. All / Unassigned filters still work.
        </p>
      )}
      {loading && sorted.length === 0 && (
        <p className="mb-2 text-xs text-[#6B7280]" aria-busy="true">Loading officers…</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[#6B7280] font-medium mr-1">Officer:</span>
        <button
          type="button"
          aria-pressed={allActive}
          onClick={() => onChange(null)}
          className={chipClass(allActive)}
        >
          All
        </button>
        <button
          type="button"
          aria-pressed={unassignedActive}
          onClick={() => onChange('unassigned')}
          className={chipClass(unassignedActive)}
        >
          Unassigned
        </button>
        {sorted.map((o) => {
          const active = activeOfficerId === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.id)}
              className={chipClass(active)}
            >
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
