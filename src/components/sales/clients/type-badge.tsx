'use client';

import { CRM_TYPE_LABEL, isCrmClientType } from '@/lib/domain/crm/types';

// Muted, brand-consistent badges. Distinguishable at a glance without
// competing with the orange primary action or the navy business pill.
const STYLES: Record<string, string> = {
  agent: 'bg-[#1B2A4A]/8 text-[#1B2A4A]',
  lender: 'bg-emerald-50 text-emerald-700',
  escrow: 'bg-violet-50 text-violet-700',
  title: 'bg-amber-50 text-amber-700',
  other: 'bg-gray-100 text-gray-500',
};

export function TypeBadge({ type, className = '' }: { type: string | null; className?: string }) {
  if (!type || !isCrmClientType(type)) return null;
  return (
    <span className={`inline-block text-xs font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${STYLES[type]} ${className}`}>
      {CRM_TYPE_LABEL[type]}
    </span>
  );
}
