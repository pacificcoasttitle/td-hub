'use client';

import { OrdersHubTable } from '@/components/shared/orders-hub-table';

export default function ClientOrdersPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">My Orders</h1>
        <p className="text-sm text-[#6B7280] mt-1">View and manage your title orders.</p>
      </div>

      <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
        <OrdersHubTable
          fetchUrl="/api/client/orders"
          actions={['cpl', 'prelim', 'proposed', 'detail', 'fees']}
          isClient
          accentColor="#F26B2B"
          showSearch
          showStatusFilter
          pageSize={20}
          feesHrefBuilder={(id) => `/client/orders/${id}/fees`}
        />
      </div>
    </div>
  );
}
