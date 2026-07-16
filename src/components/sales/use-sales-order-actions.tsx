'use client';

import { useCallback, useState } from 'react';
import { PrelimModal, DetailModal, openPrelimInNewTab } from '@/components/shared/action-modals';
import { TessaPrelimResultsModal } from '@/components/tessa/TessaPrelimResultsModal';
import type { SalesAction } from './order-actions';
import type { SalesOrder } from './types';
import { formatOrderAddress } from '@/lib/domain/orders/order-format';

function fmtAddr(o: SalesOrder): string {
  return formatOrderAddress(o);
}

export function useSalesOrderActions() {
  const [prelimOrder, setPrelimOrder] = useState<SalesOrder | null>(null);
  const [tessaOrder, setTessaOrder] = useState<SalesOrder | null>(null);
  const [detailOrder, setDetailOrder] = useState<SalesOrder | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleOrderAction = useCallback((action: SalesAction, order: SalesOrder) => {
    switch (action) {
      case 'review_prelim':
        openPrelimInNewTab(order.id).then(ok => {
          if (!ok) showToast('No prelim document found');
        });
        break;
      case 'update_prelim':
      case 'get_prelim_doc':
        setPrelimOrder(order);
        break;
      case 'prelim_summary':
      case 'regenerate_summary':
        setTessaOrder(order);
        break;
      case 'view_contacts':
      case 'view_detail':
        setDetailOrder(order);
        break;
    }
  }, [showToast]);

  const modals = (
    <>
      {prelimOrder && (
        <PrelimModal
          open
          onClose={() => setPrelimOrder(null)}
          orderId={prelimOrder.id}
          fileNumber={prelimOrder.fileNumber}
          address={fmtAddr(prelimOrder)}
        />
      )}
      {detailOrder && (
        <DetailModal
          open
          onClose={() => setDetailOrder(null)}
          orderId={detailOrder.id}
          fileNumber={detailOrder.fileNumber}
          address={fmtAddr(detailOrder)}
        />
      )}
      <TessaPrelimResultsModal
        isOpen={!!tessaOrder}
        onClose={() => setTessaOrder(null)}
        orderId={tessaOrder?.id ?? 0}
        fileNumber={tessaOrder?.fileNumber ?? ''}
      />
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1B2A4A] text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </>
  );

  return { handleOrderAction, modals };
}
