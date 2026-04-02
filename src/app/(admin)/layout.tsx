import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { SidebarNav } from '@/components/admin/sidebar-nav';

export const dynamic = 'force-dynamic';

const NAV_BY_ROLE: Record<string, string[]> = {
  super_admin: ['/dashboard', '/hub', '/orders', '/contacts', '/documents', '/jobs', '/settings', '/users'],
  admin:       ['/dashboard', '/hub', '/orders', '/contacts', '/documents', '/jobs', '/settings', '/users'],
  cs_admin:    ['/dashboard', '/hub', '/orders', '/contacts', '/documents', '/jobs'],
  sales_manager: ['/dashboard', '/orders', '/contacts'],
  sales_rep:   ['/dashboard', '/orders', '/contacts'],
  title_officer:   ['/dashboard', '/orders', '/documents'],
  escrow_officer:  ['/dashboard', '/orders', '/documents'],
  open_order_team: ['/hub', '/orders', '/contacts'],
};

const ALLOWED_ROLES = Object.keys(NAV_BY_ROLE);

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'client') redirect('/client/orders');
  if (!ALLOWED_ROLES.includes(session.role)) redirect('/login');

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
