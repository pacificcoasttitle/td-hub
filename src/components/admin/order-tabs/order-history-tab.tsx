'use client';

import { SectionHeading } from './order-overview-tab';

interface StatusHistoryEntry {
  id: number;
  status: string;
  source: string;
  notes: string | null;
  changedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_process: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  closed: 'bg-slate-100 text-slate-800',
  canceled: 'bg-red-100 text-red-800',
  duplicate: 'bg-gray-100 text-gray-600',
};

const SOURCE_LABELS: Record<string, string> = {
  softpro_sync: 'SoftPro Sync',
  manual: 'Manual',
  system: 'System',
  webhook: 'Webhook',
  manual_entry: 'Manual Entry',
  web_form: 'Web Form',
};

export function OrderHistoryTab({ history }: { history: StatusHistoryEntry[] }) {
  if (history.length === 0) {
    return (
      <div className="p-12 text-center">
        <p className="text-sm text-[#6B7280]">No status history recorded for this order.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <SectionHeading>Status Timeline</SectionHeading>
      <div className="mt-4 relative">
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200" />
        <ol className="space-y-6">
          {history.map((entry, idx) => (
            <li key={entry.id} className="relative pl-7">
              <span
                className={`absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 border-white ${idx === 0 ? 'bg-[#C5A55A]' : 'bg-gray-300'}`}
                style={{ boxShadow: '0 0 0 2px #e5e7eb' }}
              />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={entry.status} />
                    <span className="text-xs text-[#6B7280] font-medium">
                      {SOURCE_LABELS[entry.source] ?? entry.source}
                    </span>
                  </div>
                  {entry.notes && <p className="text-sm text-[#6B7280] mt-1">{entry.notes}</p>}
                </div>
                <time className="text-xs text-[#6B7280] whitespace-nowrap shrink-0">
                  {formatDateTime(entry.changedAt)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>{status.replace(/_/g, ' ')}</span>;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return '—'; }
}
