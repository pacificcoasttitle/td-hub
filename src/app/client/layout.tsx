import { requireAuth } from '@/lib/security/auth';
import { createSupabaseServer } from '@/lib/security/supabase-server';
import { redirect } from 'next/navigation';
import { ClientNav } from '@/components/client/client-nav';

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

  return (
    <div className="min-h-screen bg-[#F8F9FA]">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="h-14 sm:h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-[#1B2A4A] rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">P</span>
              </div>
              <div className="hidden sm:block">
                <p className="text-[#1A1A2E] font-semibold text-sm leading-tight">Pacific Coast Title</p>
                <p className="text-[#6B7280] text-xs leading-tight">Transaction Desk</p>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-4">
              <span className="text-sm text-[#1A1A2E] hidden sm:inline">
                {session.displayName ?? session.email}
              </span>
              <form action={handleSignOut}>
                <button
                  type="submit"
                  className="text-sm text-[#6B7280] hover:text-[#1A1A2E] transition-colors min-h-[44px] px-1"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Horizontal nav */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <ClientNav />
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>
    </div>
  );
}
