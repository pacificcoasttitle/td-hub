'use client';

import type { Delta } from '@/lib/domain/sales/header-metrics';

/**
 * Direction is carried by the ▲/▼ glyph, not colour alone. The compact label
 * ("vs Jun") is deliberately terse, so the full comparison basis rides along in
 * the title/aria text — a reader must never have to guess what it's versus.
 */
export function DeltaChip({ delta }: { delta: Delta | null }) {
  if (!delta) return null;

  const { pct, up, label, basis } = delta;
  const magnitude = Math.abs(pct);

  return (
    <span
      title={basis}
      aria-label={`${up ? 'Up' : 'Down'} ${magnitude} percent. ${basis}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold tracking-[0.2px] ${
        up
          ? 'bg-[#34C77B]/[0.14] text-[#4ADE80]'
          : 'bg-[#FF6B6B]/[0.14] text-[#FF8080]'
      }`}
    >
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      {magnitude}% {label}
    </span>
  );
}
