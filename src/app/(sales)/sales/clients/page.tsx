import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { ClientsPageClient } from '@/components/sales/clients/clients-page-client';

export const dynamic = 'force-dynamic';

const SALES_ROLES = ['sales_rep', 'sales_manager'];

export default async function SalesClientsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!SALES_ROLES.includes(session.role)) redirect('/dashboard');

  return (
    <ClientsPageClient role={session.role as 'sales_rep' | 'sales_manager'} />
  );
}
