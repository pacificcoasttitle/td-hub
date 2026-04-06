import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { DashboardContent } from '@/components/sales/dashboard-content';

export const dynamic = 'force-dynamic';

const SALES_ROLES = ['sales_rep', 'sales_manager'];

export default async function SalesDashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!SALES_ROLES.includes(session.role)) redirect('/dashboard');

  return (
    <DashboardContent
      displayName={session.displayName ?? session.email}
      role={session.role as 'sales_rep' | 'sales_manager'}
    />
  );
}
