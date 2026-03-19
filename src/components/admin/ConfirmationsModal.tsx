'use client';

import { useEffect } from 'react';

interface Props {
  orderId: number;
  fileNumber: string;
  open: boolean;
  onClose: () => void;
}

export function ConfirmationsModal({ orderId, fileNumber, open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-[#1A1A2E]">Confirmations</h2>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A2E] transition-colors text-xl leading-none">&times;</button>
        </div>
        <div className="p-6 text-center py-16">
          <p className="text-[#6B7280] text-sm">Confirmations — Coming Soon</p>
          <p className="text-[#1B2A4A] font-mono font-semibold mt-2">{fileNumber}</p>
          <p className="text-xs text-[#9CA3AF] mt-1">Order ID: {orderId}</p>
        </div>
      </div>
    </div>
  );
}
