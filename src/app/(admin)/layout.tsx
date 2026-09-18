import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { SidebarNav } from '@/components/admin/sidebar-nav';
// Shared so the nav test can assert every entry is visible to some role.
import { ADMIN_SHELL_ROLES, NAV_BY_ROLE } from '@/lib/security/nav-access';

export const dynamic = 'force-dynamic';


export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'client') redirect('/client/orders');
  if (session.role === 'sales_rep' || session.role === 'sales_manager') redirect('/sales/dashboard');
  if (!ADMIN_SHELL_ROLES.includes(session.role)) redirect('/login');

  const allowedPaths = NAV_BY_ROLE[session.role] ?? [];

  return (
    <div className="flex h-screen bg-[#F8F9FA]">
      <SidebarNav
        allowedPaths={allowedPaths}
        displayName={session.displayName ?? session.email}
        role={session.role}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
