'use client'

import { useState } from 'react'
import Link from 'next/link'

/* ------------------------------------------------------------------
   TD Hub — Login  (Concept 03: "Coastline")
   Drop-in replacement for app/login/page.tsx

   PRESERVE YOUR EXISTING AUTH LOGIC. The only thing this file changes
   is markup + styling. The section marked [AUTH] is a placeholder —
   paste your current submit handler in its place.
------------------------------------------------------------------- */

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // [AUTH] ---- keep your existing sign-in call here ----
      // await signIn({ email, password, remember })
      // router.push('/dashboard')
    } catch (err) {
      setError('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[#12172E]">
      <CoastlineBackdrop />

      {/* ---------- top bar ---------- */}
      <header className="relative z-20 flex items-center justify-between px-6 py-6 sm:px-10">
        <div className="flex items-center gap-2.5">
          <span className="h-6 w-6 rounded-[7px] bg-gradient-to-br from-[#F26B2B] to-[#F59E5B]" />
          <span className="text-sm font-bold tracking-tight text-white">
            Pacific Coast Title
          </span>
        </div>
        <p className="hidden text-[13px] text-white/60 sm:block">
          Not a client yet?{' '}
          <Link
            href="/open-order"
            className="font-semibold text-white transition-colors hover:text-[#F26B2B]"
          >
            Open an order →
          </Link>
        </p>
      </header>

      {/* ---------- body ---------- */}
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-84px)] w-full max-w-[1240px] flex-col items-center justify-center gap-12 px-6 pb-14 sm:px-10 lg:flex-row lg:items-center lg:justify-between lg:gap-16">
        {/* left: brand copy */}
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
              { n: '12', l: 'Counties' },
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

        {/* right: sign-in card */}
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

          <form onSubmit={handleSubmit} className="space-y-4">
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
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 w-full rounded-[10px] border border-white/[0.18] bg-white/10 px-3.5 pr-12 text-sm text-white transition-colors focus:border-white focus:bg-white/[0.16] focus:outline-none focus:ring-2 focus:ring-white/25"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-white/50 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center rounded-[10px] bg-[#F26B2B] text-[14.5px] font-semibold text-white shadow-[0_10px_26px_-10px_rgba(242,107,43,0.85)] transition-colors hover:bg-[#E05A1A] focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/50 focus:ring-offset-2 focus:ring-offset-[#12172E] disabled:opacity-60"
            >
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
            <Link
              href="/forgot-password"
              className="text-white/85 transition-colors hover:text-white"
            >
              Forgot?
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

/* ------------------------------------------------------------------
   Backdrop — layered SVG horizon + warm glow + vignette.
   Swap <CoastlineSvg /> for a real photo later:
   <Image src="/coast.jpg" alt="" fill priority className="object-cover" />
------------------------------------------------------------------- */
function CoastlineBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1200 640"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="tdSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2C3564" />
            <stop offset="100%" stopColor="#15193A" />
          </linearGradient>
          <linearGradient id="tdRidge1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4B5187" />
            <stop offset="100%" stopColor="#2B3160" />
          </linearGradient>
          <linearGradient id="tdRidge2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2F3563" />
            <stop offset="100%" stopColor="#1D2249" />
          </linearGradient>
          <linearGradient id="tdRidge3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1A1F42" />
            <stop offset="100%" stopColor="#10142C" />
          </linearGradient>
          <radialGradient id="tdGlow">
            <stop offset="0%" stopColor="#F26B2B" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#F26B2B" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1200" height="640" fill="url(#tdSky)" />
        <circle cx="890" cy="270" r="200" fill="url(#tdGlow)" />
        <path
          d="M0,390 C160,330 300,380 430,355 C580,326 700,390 830,368 C960,346 1090,384 1200,362 L1200,640 L0,640 Z"
          fill="url(#tdRidge1)"
        />
        <path
          d="M0,460 C170,412 320,456 470,436 C630,414 760,470 900,448 C1010,431 1120,462 1200,446 L1200,640 L0,640 Z"
          fill="url(#tdRidge2)"
        />
        <path
          d="M0,538 C180,500 330,540 500,522 C680,503 820,546 980,530 C1080,520 1150,538 1200,530 L1200,640 L0,640 Z"
          fill="url(#tdRidge3)"
        />
      </svg>

      {/* warm key light + darkening vignette for text contrast */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_78%_15%,rgba(242,107,43,0.20),transparent_55%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(18,23,46,0.18)_0%,rgba(18,23,46,0.30)_45%,rgba(18,23,46,0.72)_100%)]" />
    </div>
  )
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
  )
}
