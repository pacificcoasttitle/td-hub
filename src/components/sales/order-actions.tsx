'use client';

import { useEffect, useRef, useState } from 'react';
import type { SalesOrder } from './types';

export type SalesAction =
  | 'review_prelim' | 'prelim_summary' | 'update_prelim'
  | 'regenerate_summary' | 'get_prelim_doc'
  | 'view_contacts' | 'view_invoice' | 'view_detail';

interface Props {
  order: SalesOrder;
  onAction: (action: SalesAction, order: SalesOrder) => void;
}

export function OrderActions({ order, onAction }: Props) {
  const hasPrelim = !!order.hasPrelim;

  return (
    <div className="flex items-center gap-2">
      {hasPrelim ? (
        <>
          <button onClick={() => onAction('review_prelim', order)}
            className="bg-green-600 text-white text-xs px-3 py-1 rounded hover:bg-green-700 transition-colors whitespace-nowrap">
            Review Prelim
          </button>
          <button onClick={() => onAction('prelim_summary', order)}
            className="bg-blue-600 text-white text-xs px-3 py-1 rounded hover:bg-blue-700 transition-colors whitespace-nowrap">
            Prelim Summary
          </button>
          <Dots>
            <MenuItem onClick={() => onAction('update_prelim', order)}>Update Prelim</MenuItem>
            <MenuItem onClick={() => onAction('view_contacts', order)}>View Contacts</MenuItem>
            <MenuItem onClick={() => onAction('view_invoice', order)}>View Invoice</MenuItem>
            <MenuItem onClick={() => onAction('regenerate_summary', order)}>Regenerate Summary</MenuItem>
          </Dots>
        </>
      ) : (
        <>
          <span className="bg-blue-100 text-blue-700 text-xs px-3 py-1 rounded font-medium whitespace-nowrap">
            Not Ready
          </span>
          <Dots>
            <MenuItem onClick={() => onAction('get_prelim_doc', order)}>Get Prelim Doc</MenuItem>
            <MenuItem onClick={() => onAction('view_contacts', order)}>View Contacts</MenuItem>
            <MenuItem onClick={() => onAction('view_invoice', order)}>View Invoice</MenuItem>
          </Dots>
        </>
      )}
    </div>
  );
}

function Dots({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors">
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-30"
          onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
      {children}
    </button>
  );
}
