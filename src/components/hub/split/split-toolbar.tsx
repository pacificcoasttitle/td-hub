'use client';

import Link from 'next/link';

// ─── Toolbar — 40px ──────────────────────────────────────────────────────────
//
// The three bulk actions are ABSENT when nothing is selected, not greyed. The
// current screen renders them permanently disabled, which spends the most
// valuable strip on the page telling you what you cannot do.

export function SplitToolbar({
  searchValue, selectedCount, density, searchRef,
  onSearchChange, onSearchSubmit, onClearSelection, onBulk, onToggleDensity, onSwitchToTable,
  onNextIncomplete, incompleteAvailable,
}: {
  searchValue: string;
  selectedCount: number;
  density: 'dense' | 'roomy';
  searchRef: React.RefObject<HTMLInputElement | null>;
  onSearchChange: (v: string) => void;
  onSearchSubmit: () => void;
  onClearSelection: () => void;
  onBulk: (type: 'cpl' | 'proposed' | 'prelim') => void;
  onToggleDensity: () => void;
  onSwitchToTable: () => void;
  onNextIncomplete: () => void;
  incompleteAvailable: boolean;
}) {
  const bulk = selectedCount >= 2;

  return (
    <div className="h-10 shrink-0 bg-white border-b border-[#E5E5E5] flex items-center gap-2 px-3">
      <Link
        href="/hub/new-order"
        className="h-7 px-3 rounded-md bg-brand-orange hover:bg-brand-orange-hover text-white text-[11.5px] font-semibold inline-flex items-center gap-1 shrink-0 transition-colors"
      >
        <span aria-hidden>+</span> New Order
      </Link>

      {bulk ? (
        <>
          <span className="text-[11.5px] font-semibold text-[#171717] tabular-nums ml-1">
            {selectedCount} selected
          </span>
          <ToolbarButton onClick={() => onBulk('cpl')}>Generate CPL</ToolbarButton>
          <ToolbarButton onClick={() => onBulk('proposed')}>Proposed Insured</ToolbarButton>
          <ToolbarButton onClick={() => onBulk('prelim')}>Find Prelim</ToolbarButton>
          <ToolbarButton onClick={onClearSelection}>Clear</ToolbarButton>
        </>
      ) : (
        <>
          <form
            className="relative w-[290px] shrink-0"
            onSubmit={(e) => { e.preventDefault(); onSearchSubmit(); }}
          >
            <input
              ref={searchRef}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="file #, address, client"
              aria-label="Search all orders"
              className="w-full h-7 pl-[9px] pr-7 border border-[#E5E5E5] rounded-md text-[11.5px] bg-white outline-none focus:ring-1 focus:ring-brand-orange/30 focus:border-brand-orange placeholder:text-[#9AA0AA]"
            />
            <kbd className="absolute right-[8px] top-1/2 -translate-y-1/2 text-[10px] text-[#9AA0AA] pointer-events-none">
              ⌘/
            </kbd>
          </form>

          <ToolbarButton onClick={onNextIncomplete} disabled={!incompleteAvailable}>
            Next incomplete <kbd className="ml-1 text-[10px] font-normal opacity-60">⇥</kbd>
          </ToolbarButton>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        <ToolbarButton small onClick={onToggleDensity}>
          {density === 'dense' ? 'Dense' : 'Roomy'}
        </ToolbarButton>
        <ToolbarButton small onClick={onSwitchToTable}>Table</ToolbarButton>
      </div>
    </div>
  );
}

function ToolbarButton({
  children, onClick, small, disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  small?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        small ? 'h-6 rounded-[5px] text-[11px]' : 'h-7 rounded-md text-[11.5px]',
        'px-[9px] font-semibold shrink-0 border border-[#E5E5E5] bg-white text-[#3C4557]',
        'hover:bg-[#FAFAFB] disabled:opacity-40 disabled:hover:bg-white transition-colors',
        'outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30 focus-visible:border-brand-orange',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
