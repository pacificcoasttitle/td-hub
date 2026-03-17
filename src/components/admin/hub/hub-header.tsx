'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV = [
  { label: 'Orders', href: '/hub' },
  { label: 'Quick Entry', href: '/hub/quick-entry' },
  { label: 'New Order', href: '/hub/new-order' },
];

export function HubHeader({ displayName, signOutAction }: {
  displayName: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="h-11 bg-[#1B2A4A] flex items-center px-4 gap-6 shrink-0 text-sm select-none">
      <Link href="/hub" className="flex items-center gap-2 text-white font-bold tracking-tight mr-2">
        <span className="text-[#F26B2B]">PCT</span>
        <span className="text-white/60 font-normal">Hub</span>
      </Link>

      <nav className="flex items-center gap-1">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              pathname === n.href
                ? 'bg-white/15 text-white'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="flex-1" />

      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
        >
          <div className="w-6 h-6 rounded-full bg-[#F26B2B] flex items-center justify-center text-[10px] font-bold text-white">
            {displayName?.charAt(0)?.toUpperCase() ?? 'U'}
          </div>
          <span className="text-xs hidden sm:inline">{displayName}</span>
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1">
              <Link href="/dashboard" className="block px-3 py-2 text-xs text-[#1A1A2E] hover:bg-gray-50">
                Admin Dashboard
              </Link>
              <form action={signOutAction}>
                <button type="submit" className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50">
                  Sign Out
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
