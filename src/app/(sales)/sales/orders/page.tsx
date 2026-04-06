'use client';

import { OrdersHubTable } from '@/components/shared/orders-hub-table';

export default function SalesOrdersPage() {
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Orders</h1>
      <OrdersHubTable
        fetchUrl="/api/orders"
        actions={['cpl', 'prelim', 'notes', 'detail']}
        showSearch
        showStatusFilter
        pageSize={25}
        accentColor="#F26B2B"
      />
    </div>
  );
}
