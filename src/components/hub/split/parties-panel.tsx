'use client';

import type { OrderParty } from '@/lib/domain/orders/order-parties';

// ─── Parties ────────────────────────────────────────────────────────────────
//
// 98.5% of orders have these and there are 4.6 of them on average, which is
// why this sits in the top row beside the order card rather than below the
// fold. It is the densest real data the pane has.

export interface PartiesPanelProps {
  parties: OrderParty[];
  unnamedRoleCount: number;
  loading: boolean;
  shell?: boolean;
}

export function PartiesPanel({ parties, unnamedRoleCount, loading, shell = false }: PartiesPanelProps) {
  return (
    <section className="bg-white border border-[#EEF0F4] rounded-[9px] flex flex-col min-h-0">
      <header className="h-7 shrink-0 flex items-center justify-between px-[13px] border-b border-[#EEF0F4]">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A94A6]">
          Parties
        </h2>
        {parties.length > 0 && (
          <span className="text-[10px] text-[#8A94A6] tabular-nums">{parties.length}</span>
        )}
      </header>

      <div className="px-[13px] py-[9px] flex-1 min-h-0 overflow-y-auto">
        {loading && parties.length === 0 ? (
          <p className="text-[11.5px] text-[#8A94A6]">Loading…</p>
        ) : parties.length === 0 ? (
          <p className="text-[11.5px] text-[#8A94A6]">
            {shell
              ? 'No parties yet — SoftPro has none on this file.'
              : 'No parties on this order.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-[7px]">
            {parties.map((p) => (
              <li key={p.id} className="flex gap-[10px] min-w-0">
                <span className="w-[86px] shrink-0 text-[11px] text-[#6B7280] leading-[1.35]">
                  {p.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-[#1B2A4A] truncate leading-[1.35]"
                    title={p.name ?? p.company ?? undefined}>
                    {p.name ?? p.company}
                  </span>
                  {p.name && p.company && (
                    <span className="block text-[10.5px] text-[#8A94A6] truncate" title={p.company}>
                      {p.company}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Never silently short. If two parties were withheld because the enum
            cannot name them, the pane says so — someone checking who is on an
            order needs to know the list is partial. */}
        {unnamedRoleCount > 0 && (
          <p className="mt-[9px] pt-[7px] border-t border-[#EEF0F4] text-[10.5px] text-[#8A94A6]">
            {unnamedRoleCount === 1 ? '1 more party is' : `${unnamedRoleCount} more parties are`}
            {' '}on this order under a role the system cannot yet name
            {' '}— typically the title company and the underwriter.
          </p>
        )}
      </div>
    </section>
  );
}
