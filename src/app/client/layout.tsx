import { requireAuth } from '@/lib/security/auth';
import { createSupabaseServer } from '@/lib/security/supabase-server';
import { redirect } from 'next/navigation';
import { PortalHeader, MobileTabBar } from '@/components/client/client-nav';

export const dynamic = 'force-dynamic';

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();

  async function handleSignOut() {
    'use server';
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
    redirect('/login');
  }

  const displayName = session.displayName ?? session.email ?? 'User';

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <PortalHeader displayName={displayName} signOutAction={handleSignOut} />
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-8 pb-24 md:pb-8">
        {children}
      </main>
      <MobileTabBar />
    </div>
  );
}
