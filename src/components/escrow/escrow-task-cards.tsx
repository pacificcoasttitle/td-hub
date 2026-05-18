'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, Info } from 'lucide-react';
import type { EscrowTasksResponse, TaskPriority } from '@/lib/domain/escrow/tasks';

export interface EscrowTaskCardsProps {
  activeFilter: TaskPriority | null;
  onFilterChange: (priority: TaskPriority | null) => void;
  onTasksLoaded?: (resp: EscrowTasksResponse) => void;
}

type CardConfig = {
  priority: TaskPriority;
  label: string;
  Icon: typeof AlertTriangle;
  bg: string;
  bgHover: string;
  border: string;
  text: string;
  ring: string;
  iconColor: string;
};

const CARDS: CardConfig[] = [
  {
    priority: 1,
    label: 'Needs Attention',
    Icon: AlertTriangle,
    bg: 'bg-red-50',
    bgHover: 'hover:bg-red-100',
    border: 'border-red-200',
    text: 'text-red-900',
    ring: 'ring-red-400',
    iconColor: 'text-red-600',
  },
  {
    priority: 2,
    label: 'Upcoming',
    Icon: Clock,
    bg: 'bg-amber-50',
    bgHover: 'hover:bg-amber-100',
    border: 'border-amber-200',
    text: 'text-amber-900',
    ring: 'ring-amber-400',
    iconColor: 'text-amber-600',
  },
  {
    priority: 3,
    label: 'Informational',
    Icon: Info,
    bg: 'bg-gray-50',
    bgHover: 'hover:bg-gray-100',
    border: 'border-gray-200',
    text: 'text-gray-900',
    ring: 'ring-gray-400',
    iconColor: 'text-gray-500',
  },
];

export function EscrowTaskCards({ activeFilter, onFilterChange, onTasksLoaded }: EscrowTaskCardsProps) {
  const [data, setData] = useState<EscrowTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/escrow/tasks')
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load tasks (${r.status})`);
        return r.json() as Promise<EscrowTasksResponse>;
      })
      .then((resp) => {
        if (cancelled) return;
        setData(resp);
        onTasksLoaded?.(resp);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load tasks');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [onTasksLoaded]);

  function handleClick(priority: TaskPriority) {
    onFilterChange(activeFilter === priority ? null : priority);
  }

  if (error) {
    return (
      <div className="px-4 pt-3">
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          Failed to load task signals. {error}
        </div>
      </div>
    );
  }

  function countFor(priority: TaskPriority): number | null {
    if (!data) return null;
    if (priority === 1) return data.summary.priority1Count;
    if (priority === 2) return data.summary.priority2Count;
    return data.summary.priority3Count;
  }

  return (
    <div className="px-4 pt-3 shrink-0">
      <div className="grid grid-cols-3 gap-3">
        {CARDS.map((c) => {
          const count = countFor(c.priority);
          const isActive = activeFilter === c.priority;
          const Icon = c.Icon;
          return (
            <button
              key={c.priority}
              type="button"
              onClick={() => handleClick(c.priority)}
              aria-pressed={isActive}
              className={[
                'text-left rounded-lg border px-4 py-3 transition-all',
                c.bg,
                c.bgHover,
                c.border,
                c.text,
                isActive ? `ring-2 ${c.ring}` : '',
              ].join(' ')}
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${c.iconColor}`} aria-hidden="true" />
                <span className="text-sm font-semibold">{c.label}</span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                {loading || count === null ? (
                  <span className="inline-block h-6 w-10 bg-white/60 rounded animate-pulse" aria-label="Loading count" />
                ) : (
                  <span className="text-2xl font-bold tabular-nums">{count}</span>
                )}
                <span className="text-xs opacity-70">{count === 1 ? 'item' : 'items'}</span>
              </div>
              <div className="mt-1 text-xs opacity-70">
                {isActive ? 'Filter active — click to clear' : 'Click to filter →'}
              </div>
            </button>
          );
        })}
      </div>
      {activeFilter !== null && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => onFilterChange(null)}
            className="text-xs text-[#1B2A4A] hover:underline font-medium"
          >
            Clear filter
          </button>
        </div>
      )}
    </div>
  );
}
