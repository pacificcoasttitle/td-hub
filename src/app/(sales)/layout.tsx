import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { SalesSidebar } from '@/components/sales/sales-sidebar';

export const dynamic = 'force-dynamic';

const SALES_ROLES = ['sales_rep', 'sales_manager'] as const;
type SalesRole = (typeof SALES_ROLES)[number];

function isSalesRole(role: string): role is SalesRole {
  return (SALES_ROLES as readonly string[]).includes(role);
}

const ROLE_REDIRECT: Record<string, string> = {
  client: '/client/dashboard',
  open_order_team: '/hub',
  title_production: '/title-production',
};

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  if (!isSalesRole(session.role)) {
    redirect(ROLE_REDIRECT[session.role] ?? '/dashboard');
  }

  return (
    <div className="flex h-screen bg-[#F5F6FA]">
      <SalesSidebar
        role={session.role}
        userName={session.displayName ?? session.email}
      />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
