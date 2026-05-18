'use client';

export type OfficerFilterValue = number | null | 'unassigned';

export interface OfficerOption {
  id: number;
  name: string;
}

export interface OfficerFilterChipsProps {
  activeOfficerId: OfficerFilterValue;
  onChange: (officerId: OfficerFilterValue) => void;
  officers: OfficerOption[];
}

export function OfficerFilterChips({ activeOfficerId, onChange, officers }: OfficerFilterChipsProps) {
  const sorted = [...officers].sort((a, b) => a.name.localeCompare(b.name));

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
