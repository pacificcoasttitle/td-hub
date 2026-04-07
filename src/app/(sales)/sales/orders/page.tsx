import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { SalesOrdersClient } from '@/components/sales/sales-orders-client';

export const dynamic = 'force-dynamic';

const SALES_ROLES = ['sales_rep', 'sales_manager'];

export default async function SalesOrdersPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!SALES_ROLES.includes(session.role)) redirect('/dashboard');

  return (
    <SalesOrdersClient role={session.role as 'sales_rep' | 'sales_manager'} />
  );
}
