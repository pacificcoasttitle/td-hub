'use client';

import { useState } from 'react';
import Image from 'next/image';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { TdWaves } from '@/components/brand/td-waves';

/* ------------------------------------------------------------------
   TD Hub — Login  (Concept 03: "Coastline")
   Markup/styling from docs/redesigned/login; auth logic preserved.
------------------------------------------------------------------- */

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  async function resolveRedirect(): Promise<string> {
    try {
      const r = await fetch('/api/auth/session');
      if (r.ok) {
        const { role } = await r.json();
        if (role === 'client') return '/client/dashboard';
        if (role === 'open_order_team') return '/hub';
        if (role === 'escrow_assistant') return '/hub';
        if (role === 'title_production') return '/title-production';
        if (role === 'sales_rep') return '/sales/dashboard';
        if (role === 'sales_manager') return '/sales/dashboard';
      }
    } catch { /* fall through */ }
    return '/dashboard';
  }

  // [AUTH] — existing sign-in flow (unchanged)
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const dest = await resolveRedirect();
    router.push(dest);
    router.refresh();
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[#12172E]">
      <TdWaves />

      <header className="relative z-20 flex items-center justify-between px-6 py-6 sm:px-10">
        <div className="flex items-center">
          <Image
            src="/logo2.png"
            alt="Pacific Coast Title"
            width={200}
            height={40}
            className="h-9 w-auto"
            priority
          />
        </div>
      </header>

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-84px)] w-full max-w-[1240px] flex-col items-center justify-center gap-12 px-6 pb-14 sm:px-10 lg:flex-row lg:items-center lg:justify-between lg:gap-16">
        <div className="w-full max-w-[440px] text-white">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#F26B2B]">
            Transaction Desk Hub
          </p>
          <h1 className="font-serif text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] sm:text-[46px]">
            Close with confidence.
          </h1>
          <p className="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-white/65">
            Every order, prelim, and settlement statement for your desk — in one
            place, from the county recorder to the closing table.
          </p>

          <dl className="mt-8 flex border-t border-white/15 pt-5">
            {[
              { n: '45+', l: 'Years' },
              { n: '100K+', l: 'Families' },
              { n: 'All', l: 'Counties in California' },
            ].map((s, i, arr) => (
              <div
                key={s.l}
                className={
                  i < arr.length - 1
                    ? 'mr-7 border-r border-white/10 pr-7 sm:mr-9 sm:pr-9'
                    : ''
                }
              >
                <dt className="sr-only">{s.l}</dt>
                <dd className="text-[22px] font-bold tracking-[-0.02em]">
                  {s.n}
                </dd>
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.06em] text-white/50">
                  {s.l}
                </p>
              </div>
            ))}
          </dl>
        </div>

        <div className="w-full max-w-[380px] rounded-[18px] border border-white/[0.16] bg-white/[0.09] p-8 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-white">
            Sign in
          </h2>
          <p className="mb-6 mt-1.5 text-[13px] text-white/55">
            Use your Pacific Coast Title account.
          </p>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-400/30 bg-red-500/15 px-3.5 py-2.5 text-[13px] text-red-100"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-[11.5px] font-medium text-white/70"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@pct.com"
                className="h-12 w-full rounded-[10px] border border-white/[0.18] bg-white/10 px-3.5 text-sm text-white placeholder:text-white/40 transition-colors focus:border-white focus:bg-white/[0.16] focus:outline-none focus:ring-2 focus:ring-white/25"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-[11.5px] font-medium text-white/70"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 w-full rounded-[10px] border border-white/[0.18] bg-white/10 px-3.5 pr-12 text-sm text-white transition-colors focus:border-white focus:bg-white/[0.16] focus:outline-none focus:ring-2 focus:ring-white/25"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-white/50 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                >
                  <EyeIcon off={showPw} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#F26B2B] text-[14.5px] font-semibold text-white shadow-[0_10px_26px_-10px_rgba(242,107,43,0.85)] transition-colors hover:bg-[#E05A1A] focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/50 focus:ring-offset-2 focus:ring-offset-[#12172E] disabled:opacity-60"
            >
              {loading && (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 flex items-center justify-between text-[12.5px] text-white/55">
            <label className="flex cursor-pointer select-none items-center gap-2">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-[#F26B2B]"
              />
              Keep me signed in
            </label>
            {/* No /forgot-password route yet — same no-op affordance as before. */}
            <button
              type="button"
              className="text-white/85 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40 rounded"
            >
              Forgot?
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  );
}
