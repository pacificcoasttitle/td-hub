'use client';

import {
  HUB_QUEUES, QUEUE_DIVIDER_BEFORE, formatQueueCount,
  type HubQueueCounts, type HubQueueId, type QueueTone,
} from '@/lib/domain/orders/hub-queues';

// 58px of vertical tiles. Three-letter mono codes, no icons: at 46px a code is
// unambiguous and an icon is a guess. The full name rides in aria-label, the
// title attribute and the list header, so the code is never the only signal.

const COUNT_TONE: Record<QueueTone, string> = {
  default: 'text-[#8A8F9A]',
  warning: 'text-[#B4620B]',
  error: 'text-[#C0392B]',
};

export function QueueRail({
  active, counts, onSelect,
}: {
  active: HubQueueId;
  counts: HubQueueCounts | null;
  onSelect: (id: HubQueueId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Order queues"
      aria-orientation="vertical"
      className="w-[58px] shrink-0 bg-[#F7F8FA] border-r border-[#E5E5E5] flex flex-col items-center py-[7px] gap-[2px] overflow-hidden"
    >
      {HUB_QUEUES.map((q) => {
        const isActive = q.id === active;
        const count = counts?.[q.id];
        return (
          <div key={q.id} className="contents">
            {q.id === QUEUE_DIVIDER_BEFORE && (
              <div className="w-[26px] h-px bg-[#E1E4E9] my-[5px]" aria-hidden />
            )}
            <button
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-label={`${q.label}${count === undefined ? '' : `, ${count} orders`}`}
              title={`${q.label}  (${q.position})`}
              onClick={() => onSelect(q.id)}
              className={[
                'w-[46px] h-[42px] rounded-[8px] flex flex-col items-center justify-center gap-[1px]',
                'transition-colors outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30',
                isActive ? 'bg-brand-navy' : 'hover:bg-[#EDEFF3]',
              ].join(' ')}
            >
              <span
                className={[
                  'font-mono text-[10px] font-semibold tracking-[0.06em]',
                  isActive ? 'text-white' : 'text-[#5C6474]',
                ].join(' ')}
              >
                {q.code}
              </span>
              <span
                className={[
                  'font-mono text-[10px] font-semibold tabular-nums',
                  isActive ? 'text-[#B9C6DD]' : COUNT_TONE[q.tone],
                ].join(' ')}
              >
                {count === undefined ? '·' : formatQueueCount(count)}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
