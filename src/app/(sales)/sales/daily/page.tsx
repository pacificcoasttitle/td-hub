import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { DailyTable } from '@/components/sales/daily-table';

export const dynamic = 'force-dynamic';

export default async function SalesDailyPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'sales_manager') redirect('/sales/dashboard');

  return <DailyTable />;
}
