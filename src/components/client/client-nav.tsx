'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { handleSignOut } from '@/lib/security/sign-out';

/* ─── Desktop Nav Items ────────────────────────────────────────────────────── */
const NAV_ITEMS = [
  { label: 'My Files', href: '/client/dashboard' },
  { label: 'Open New Order', href: '/client/orders/new' },
];

/* ─── Mobile Tab Items ─────────────────────────────────────────────────────── */
const MOBILE_TABS = [
  {
    label: 'Files',
    href: '/client/dashboard',
    icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
  },
  {
    label: 'New',
    href: '/client/orders/new',
    icon: 'M12 4v16m8-8H4',
  },
  {
    label: 'Activity',
    href: '/client/dashboard',
    icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  },
  {
    label: 'Profile',
    href: '/client/dashboard',
    icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
];

/* ─── Portal Header ────────────────────────────────────────────────────────── */
interface PortalHeaderProps {
  displayName: string;
}

export function PortalHeader({ displayName }: PortalHeaderProps) {
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const initial = (displayName ?? 'U').charAt(0).toUpperCase();

  function isActive(href: string) {
    if (href === '/client/dashboard') {
      return pathname === '/client/dashboard' || (pathname.startsWith('/client/orders/') && !pathname.includes('/new'));
    }
    return pathname === href;
  }

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[#E5E7EB]">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 sm:px-8 py-4">
        <Link href="/client/dashboard" className="flex items-center gap-2">
          <div className="h-8 w-8 bg-[#1B2A4A] rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">P</span>
          </div>
          <span className="text-lg font-semibold tracking-tight text-[#1B2A4A] hidden sm:inline">
            Pacific Coast Title
          </span>
        </Link>

        <div className="flex items-center gap-6">
          {/* User dropdown */}
          <div ref={dropRef} className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[#F3F4F6] transition-colors"
            >
              <div className="h-9 w-9 rounded-full bg-[#1B2A4A] flex items-center justify-center border border-[#E5E7EB]">
                <span className="text-white text-sm font-medium">{initial}</span>
              </div>
              <span className="text-sm font-medium text-[#1B2A4A] hidden sm:inline">{displayName}</span>
              <svg className="h-4 w-4 text-[#4B5563] hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg border border-[#E5E7EB] shadow-lg py-1 z-50">
                <button onClick={handleSignOut} className="w-full text-left px-4 py-2.5 text-sm text-[#DC2626] hover:bg-[#FEF2F2] transition-colors">
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-8 max-w-7xl mx-auto px-4 sm:px-8 pb-0">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative pb-3.5 text-sm font-medium transition-colors ${
                active ? 'text-[#1B2A4A]' : 'text-[#4B5563] hover:text-[#1B2A4A]'
              }`}
            >
              {item.label}
              {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#F26B2B]" />}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

/* ─── Mobile Bottom Tab Bar ────────────────────────────────────────────────── */
export function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();

  function isActive(href: string, label: string) {
    if (label === 'Files') return pathname === '/client/dashboard' || (pathname.startsWith('/client/orders') && !pathname.includes('/new'));
    if (label === 'New') return pathname === '/client/orders/new';
    return false;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#E5E7EB] md:hidden" style={{ height: 56 }}>
      <div className="flex items-center justify-around h-full max-w-lg mx-auto">
        {MOBILE_TABS.map((tab) => {
          const active = isActive(tab.href, tab.label);
          return (
            <button
              key={tab.label}
              onClick={() => router.push(tab.href)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
                active ? 'text-[#F26B2B]' : 'text-[#9CA3AF]'
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
              </svg>
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
