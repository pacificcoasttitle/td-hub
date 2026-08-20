'use client';

import { useId } from 'react';

/**
 * Shared Coastline ridge SVG + warm glow. Used on login (and any future
 * full-canvas surfaces) so the wave geometry can't drift from the brand page.
 *
 * `fixed` keeps the backdrop from being repainted on scroll when the host
 * page grows taller than the viewport.
 */
export function TdWaves({ className = '' }: { className?: string }) {
  const uid = useId().replace(/:/g, '');
  const sky = `tdSky-${uid}`;
  const ridge1 = `tdRidge1-${uid}`;
  const ridge2 = `tdRidge2-${uid}`;
  const ridge3 = `tdRidge3-${uid}`;
  const glow = `tdGlow-${uid}`;

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 ${className}`}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1200 640"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2C3564" />
            <stop offset="100%" stopColor="#15193A" />
          </linearGradient>
          <linearGradient id={ridge1} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4B5187" />
            <stop offset="100%" stopColor="#2B3160" />
          </linearGradient>
          <linearGradient id={ridge2} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2F3563" />
            <stop offset="100%" stopColor="#1D2249" />
          </linearGradient>
          <linearGradient id={ridge3} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1A1F42" />
            <stop offset="100%" stopColor="#10142C" />
          </linearGradient>
          <radialGradient id={glow}>
            <stop offset="0%" stopColor="#F26B2B" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#F26B2B" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1200" height="640" fill={`url(#${sky})`} />
        <circle cx="890" cy="270" r="200" fill={`url(#${glow})`} />
        <path
          d="M0,390 C160,330 300,380 430,355 C580,326 700,390 830,368 C960,346 1090,384 1200,362 L1200,640 L0,640 Z"
          fill={`url(#${ridge1})`}
        />
        <path
          d="M0,460 C170,412 320,456 470,436 C630,414 760,470 900,448 C1010,431 1120,462 1200,446 L1200,640 L0,640 Z"
          fill={`url(#${ridge2})`}
        />
        <path
          d="M0,538 C180,500 330,540 500,522 C680,503 820,546 980,530 C1080,520 1150,538 1200,530 L1200,640 L0,640 Z"
          fill={`url(#${ridge3})`}
        />
      </svg>

      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_78%_15%,rgba(242,107,43,0.20),transparent_55%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(18,23,46,0.18)_0%,rgba(18,23,46,0.30)_45%,rgba(18,23,46,0.72)_100%)]" />
    </div>
  );
}
