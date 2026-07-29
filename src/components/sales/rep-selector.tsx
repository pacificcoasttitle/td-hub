'use client';

import { useEffect, useState } from 'react';
import type { SalesRep } from './types';

interface Props {
  selectedRepId: number | null;
  onSelect: (id: number | null) => void;
  /** Label for the "viewing my own data" option. Defaults to the dashboard wording. */
  ownLabel?: string;
}

export function RepSelector({ selectedRepId, onSelect, ownLabel = 'My Stats' }: Props) {
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sales/reps')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.reps) setReps(d.reps); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="h-9 w-48 bg-gray-200 rounded-lg animate-pulse" />;
  }

  if (reps.length <= 1) return null;

  return (
    <select
      value={selectedRepId ?? ''}
      onChange={e => onSelect(e.target.value === '' ? null : Number(e.target.value))}
      className="h-9 px-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white text-gray-900
                 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A] cursor-pointer"
    >
      <option value="">{ownLabel}</option>
      {reps.slice(1).map(r => (
        <option key={r.id} value={r.id}>{r.fullName || r.email}</option>
      ))}
    </select>
  );
}
