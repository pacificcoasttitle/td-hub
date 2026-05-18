'use client';

export interface QuickActionButtonProps {
  label: string;
  count: number;
  disabled: boolean;
  onClick: () => void;
}

export function QuickActionButton({ label, count, disabled, onClick }: QuickActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 h-9 border border-[#1B2A4A] text-[#1B2A4A] text-xs font-medium rounded-lg hover:bg-[#1B2A4A]/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5 shrink-0"
    >
      {label}
      {count > 0 && (
        <span className="bg-[#F26B2B] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
          {count}
        </span>
      )}
    </button>
  );
}
