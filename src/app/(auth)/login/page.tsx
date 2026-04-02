'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function resolveRedirect(): Promise<string> {
    try {
      const r = await fetch('/api/auth/session');
      if (r.ok) {
        const { role } = await r.json();
        if (role === 'client') return '/client/dashboard';
        if (role === 'open_order_team') return '/hub';
        if (role === 'title_production') return '/title-production';
      }
    } catch { /* fall through */ }
    return '/dashboard';
  }

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
    <div className="min-h-screen flex">
      {/* Left — Navy brand panel (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-[60%] bg-[#1B2A4A] relative overflow-hidden flex-col justify-center px-16 xl:px-24">
        {/* Geometric pattern overlay */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 40px, white 40px, white 41px),
                            repeating-linear-gradient(-45deg, transparent, transparent 40px, white 40px, white 41px)`,
        }} />
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#F26B2B]/10 rounded-full -translate-y-1/3 translate-x-1/3 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-[#F26B2B]/5 rounded-full translate-y-1/3 -translate-x-1/3 blur-3xl" />

        <div className="relative z-10">
          <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-3">
            Pacific Coast<br />Title Company
          </h1>
          <p className="text-xl xl:text-2xl font-semibold text-[#F26B2B] mb-12">
            Close with Confidence
          </p>

          <div className="flex gap-8 xl:gap-12">
            <StatBlock value="45+" label="Years" />
            <StatBlock value="100K+" label="Families" />
            <StatBlock value="12" label="Counties" />
          </div>
        </div>
      </div>

      {/* Right — Login form */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Mobile top accent bar */}
        <div className="h-2 bg-[#1B2A4A] lg:hidden" />

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            {/* Logo / brand */}
            <div className="mb-10">
              <div className="flex items-center gap-2 mb-2 lg:hidden justify-center">
                <span className="text-xl font-bold text-[#1B2A4A]">Pacific Coast Title</span>
              </div>
              <h2 className="text-2xl font-semibold text-[#1A1A2E] lg:mb-1">
                Sign in to your account
              </h2>
              <p className="text-sm text-[#6B7280] hidden lg:block">
                Welcome back. Enter your credentials to continue.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-[#1A1A2E] mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full h-12 px-4 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/30 focus:border-[#F26B2B] transition-colors"
                  placeholder="you@pct.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-[#1A1A2E] mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full h-12 px-4 pr-12 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/30 focus:border-[#F26B2B] transition-colors"
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#6B7280] p-1">
                    {showPw ? (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" /></svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-[#F26B2B] text-white rounded-lg font-semibold text-sm hover:bg-[#E05A1A] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading && (
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button className="text-sm text-[#6B7280] hover:text-[#4B5563] transition-colors">
                Forgot password?
              </button>
            </div>

            {/* Mobile footer */}
            <div className="mt-16 text-center lg:hidden">
              <p className="text-xs text-[#9CA3AF]">Pacific Coast Title Company</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-3xl xl:text-4xl font-bold text-white">{value}</p>
      <p className="text-sm text-white/50 mt-1">{label}</p>
    </div>
  );
}
