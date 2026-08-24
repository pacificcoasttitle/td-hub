'use client';

// ─── Status bar — 32px ───────────────────────────────────────────────────────
//
// The legend is the app teaching its own shortcuts. It earns 32px precisely
// because it is always visible: behind a help modal nobody would ever find it.

const LEGEND: Array<[string, string]> = [
  ['j k', 'move'],
  ['/', 'filter'],
  ['c', 'CPL'],
  ['i', 'proposed insured'],
  ['p', 'prelim'],
  ['n', 'note'],
  ['⇥', 'next incomplete'],
];

export function HubStatusBar({
  queueLabel, queueCount, fileNumber, address,
}: {
  queueLabel: string;
  queueCount: number | null;
  fileNumber: string | null;
  address: string | null;
}) {
  return (
    <div className="h-8 shrink-0 bg-white border-t border-[#E5E5E5] flex items-center px-3 gap-3 overflow-hidden">
      <span className="text-[11.5px] text-[#6B7280] shrink-0">
        {queueLabel}
        {queueCount !== null && (
          <>
            <span className="mx-[6px] text-[#C9CDD4]">·</span>
            <span className="tabular-nums">{queueCount.toLocaleString('en-US')}</span> orders
          </>
        )}
      </span>
      {fileNumber && (
        <>
          <span className="text-[#E5E5E5] shrink-0" aria-hidden>|</span>
          <span className="font-mono text-[11.5px] text-[#171717] shrink-0">{fileNumber}</span>
        </>
      )}

      {/* Selection changes are announced here rather than by moving focus, so a
          screen-reader user hears the file without losing their place. */}
      <span aria-live="polite" className="sr-only">
        {fileNumber ? `${fileNumber}${address ? `, ${address}` : ''}` : ''}
      </span>

      <div className="ml-auto hidden lg:flex items-center gap-[10px] shrink-0">
        {LEGEND.map(([key, label]) => (
          <span key={key} className="text-[10.5px] text-[#9AA0AA] whitespace-nowrap">
            <kbd className="font-sans font-semibold text-[#6B7280] bg-[#F2F3F5] border border-[#E5E5E5] rounded-[3px] px-[4px] py-[1px]">
              {key}
            </kbd>{' '}
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
