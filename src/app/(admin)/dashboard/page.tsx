import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { AdminDashboardTabs } from '@/components/admin/dashboards/admin-dashboard-tabs';
import { SalesRepDashboard } from '@/components/admin/dashboards/sales-rep-dashboard';
import { TitleOfficerDashboard } from '@/components/admin/dashboards/title-officer-dashboard';
import { EscrowOfficerDashboard } from '@/components/admin/dashboards/escrow-officer-dashboard';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  if (session.role === 'client') redirect('/client/orders');

  const isAdmin = ADMIN_ROLES.includes(session.role);
  const params = await searchParams;
  const initialView = (params.view === 'sales' ? 'sales' : 'ops') as 'ops' | 'sales';

  const title = isAdmin ? 'Dashboard' : 'My Dashboard';
  const sub = isAdmin
    ? (initialView === 'sales' ? 'Team performance & sales leaderboard' : 'Operations command center')
    : session.role === 'sales_rep'
      ? 'Your pipeline at a glance'
      : 'Your workload at a glance';

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">{title}</h1>
        <p className="text-sm text-[#6B7280] mt-1">{sub}</p>
      </div>

      {isAdmin && <AdminDashboardTabs initialView={initialView} />}
      {session.role === 'sales_rep' && <SalesRepDashboard displayName={session.displayName} />}
      {session.role === 'title_officer' && <TitleOfficerDashboard displayName={session.displayName} />}
      {session.role === 'escrow_officer' && <EscrowOfficerDashboard displayName={session.displayName} />}
    </div>
  );
}
