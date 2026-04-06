import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { ClientIntelligence } from '@/components/sales/client-intelligence';

export const dynamic = 'force-dynamic';

const SALES_ROLES = ['sales_rep', 'sales_manager'];

export default async function SalesSummaryPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!SALES_ROLES.includes(session.role)) redirect('/dashboard');

  return (
    <ClientIntelligence
      role={session.role as 'sales_rep' | 'sales_manager'}
    />
  );
}
