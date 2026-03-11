import { requireAuth } from '@/lib/security/auth';
import { createSupabaseServer } from '@/lib/security/supabase-server';
import { redirect } from 'next/navigation';

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
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-[#1B2A4A] rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">P</span>
            </div>
            <div>
              <p className="text-[#1A1A2E] font-semibold text-sm leading-tight">Pacific Coast Title</p>
              <p className="text-[#6B7280] text-xs leading-tight">Transaction Desk</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-[#1A1A2E]">
              {session.displayName ?? session.email}
            </span>
            <form action={handleSignOut}>
              <button
                type="submit"
                className="text-sm text-[#6B7280] hover:text-[#1A1A2E] transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
