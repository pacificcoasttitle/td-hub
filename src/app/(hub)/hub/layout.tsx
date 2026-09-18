import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { HubHeader } from '@/components/admin/hub/hub-header';

export const dynamic = 'force-dynamic';

const HUB_ROLES = ['open_order_team', 'escrow_assistant', 'super_admin', 'admin', 'cs_admin'];

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!HUB_ROLES.includes(session.role)) redirect('/dashboard');

  return (
    <div className="h-screen flex flex-col bg-[#F8F9FA]">
      <HubHeader displayName={session.displayName ?? session.email} role={session.role} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
