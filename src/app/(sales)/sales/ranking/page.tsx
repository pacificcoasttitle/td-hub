import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { RankingContent } from './ranking-content';

export const dynamic = 'force-dynamic';

export default async function SalesRankingPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'sales_manager') redirect('/sales/dashboard');

  return <RankingContent />;
}
