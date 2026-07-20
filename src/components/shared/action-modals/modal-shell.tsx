'use client';

import { useEffect } from 'react';

export type ModalSize = 'default' | 'wide' | 'xl';

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** @deprecated Prefer size="wide". Kept so existing callers stay visually unchanged. */
  wide?: boolean;
  /** Explicit size. DetailModal uses "xl"; other modals keep default/wide. */
  size?: ModalSize;
  accentColor?: string;
  children: React.ReactNode;
}

function resolveSize(size: ModalSize | undefined, wide: boolean | undefined): ModalSize {
  if (size) return size;
  return wide ? 'wide' : 'default';
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  default: 'w-full max-w-lg max-h-[80vh]',
  wide: 'w-full max-w-4xl max-h-[80vh]',
  xl: 'w-full max-w-6xl max-h-[90vh]',
};

export function ModalShell({ open, onClose, title, subtitle, wide, size, children }: ModalShellProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const resolved = resolveSize(size, wide);
  const panelClass = SIZE_CLASSES[resolved];
  const overlayAlign = resolved === 'xl'
    ? 'items-center justify-center'
    : 'items-start justify-center pt-[10vh]';

  return (
    <div className={`fixed inset-0 z-50 flex ${overlayAlign} px-4`}>
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative bg-white rounded-xl shadow-2xl overflow-hidden ${panelClass} flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0 bg-[#1B2A4A]">
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            {subtitle && <p className="text-xs text-white/50 mt-0.5 font-mono">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1 -mr-1" aria-label="Close">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
