'use client';

import { Clock, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { CrmSignal } from './types';

// The one chip a rep triages from. Tones map to the domain verdict, never to a
// local re-derivation — momentum is success, gone-quiet or declining is warning,
// steady is neutral, and "not enough history" renders nothing at all rather
// than implying the client is fine.

const TONE: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-800',
  neutral: 'bg-gray-100 text-gray-600',
  muted: 'bg-transparent text-gray-400',
};

const ICON = {
  momentum: TrendingUp,
  declining: TrendingDown,
  quiet: Clock,
  steady: Minus,
} as const;

export function SignalChip({
  signal,
  size = 'sm',
}: {
  signal: CrmSignal | null | undefined;
  size?: 'sm' | 'md';
}) {
  if (!signal || signal.kind === 'unknown' || !signal.label) return null;

  const Icon = ICON[signal.kind as keyof typeof ICON];
  const pad = size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-xs';

  return (
    <span
      title={signal.detail ?? undefined}
      className={`inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap ${pad} ${TONE[signal.tone]}`}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {signal.label}
    </span>
  );
}
