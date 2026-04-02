'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { handleSignOut } from '@/lib/security/sign-out';

/* ── Types ─────────────────────────────────────────────────────────────────── */

type DirectLink = { kind: 'link'; label: string; href: string; icon: React.ReactNode };
type Section    = { kind: 'section'; label: string; icon: React.ReactNode; children: { label: string; href: string }[] };
type NavEntry   = DirectLink | Section;

/* ── Nav structure ─────────────────────────────────────────────────────────── */

const NAV: NavEntry[] = [
  { kind: 'link', label: 'Dashboard', href: '/dashboard', icon: <I d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10-1a1 1 0 00-1 1v3a1 1 0 001 1h4a1 1 0 001-1V5a1 1 0 00-1-1h-4zm-10 9a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zm10 0a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5z" /> },

  { kind: 'section', label: 'Orders', icon: <I d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />, children: [
    { label: 'Orders', href: '/orders' },
  ]},

  { kind: 'section', label: 'Contacts', icon: <I d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />, children: [
    { label: 'Title Officers', href: '/contacts/title-officers' },
    { label: 'Escrow Officers', href: '/contacts/escrow-officers' },
    { label: 'Sales Reps', href: '/contacts/sales-reps' },
  ]},

  { kind: 'section', label: 'Clients', icon: <I d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />, children: [
    { label: 'Agents', href: '/contacts/agents' },
    { label: 'Escrow Companies', href: '/contacts/escrow-companies' },
    { label: 'Lenders', href: '/contacts/lenders' },
    { label: 'Mortgage Brokers', href: '/contacts/mortgage-brokers' },
    { label: 'Companies', href: '/contacts/companies' },
  ]},

  { kind: 'link', label: 'Documents', href: '/documents', icon: <I d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /> },

  { kind: 'section', label: 'System', icon: <I d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />, children: [
    { label: 'Settings', href: '/settings' },
    { label: 'Notifications', href: '/notifications' },
    { label: 'Job Log', href: '/jobs' },
    { label: 'Users & Roles', href: '/users' },
  ]},
  { kind: 'link', label: 'Hub', href: '/hub', icon: <I d="M13 10V3L4 14h7v7l9-11h-7z" /> },
  { kind: 'link', label: 'Title Production', href: '/title-production', icon: <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /> },
];

/* ── Permission helpers ────────────────────────────────────────────────────── */

function canSee(href: string, allowed: string[]): boolean {
  return allowed.some(p => href === p || href.startsWith(p + '/'));
}

function sectionVisible(entry: Section, allowed: string[]): boolean {
  return entry.children.some(c => canSee(c.href, allowed));
}

/* ── Component ─────────────────────────────────────────────────────────────── */

interface SidebarNavProps {
  allowedPaths: string[];
  displayName: string;
  role: string;
}

export function SidebarNav({ allowedPaths, displayName, role }: SidebarNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    for (const entry of NAV) {
      if (entry.kind === 'section' && entry.children.some(c => pathname === c.href || pathname.startsWith(c.href + '/'))) {
        setOpen(entry.label);
        return;
      }
    }
  }, [pathname]);

  function toggle(label: string) {
    setOpen(prev => prev === label ? null : label);
  }

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <aside className="w-64 bg-[#1B2A4A] flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10">
        <h1 className="text-white font-bold text-lg tracking-tight">TD Hub</h1>
        <p className="text-white/50 text-xs mt-0.5">Pacific Coast Title</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(entry => {
          /* ── Direct link ── */
          if (entry.kind === 'link') {
            if (!canSee(entry.href, allowedPaths)) return null;
            const active = isActive(entry.href);
            return (
              <Link key={entry.href} href={entry.href}
                className={`group flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${active
                    ? 'text-white bg-white/10 border-l-[3px] border-[#C5A55A] pl-[13px]'
                    : 'text-white hover:bg-white/10'
                  }`}>
                <span className="w-5 h-5 flex items-center justify-center shrink-0">{entry.icon}</span>
                {entry.label}
              </Link>
            );
          }

          /* ── Collapsible section ── */
          if (!sectionVisible(entry, allowedPaths)) return null;
          const expanded = open === entry.label;
          const hasActiveChild = entry.children.some(c => isActive(c.href));

          return (
            <div key={entry.label}>
              {/* Parent button */}
              <button onClick={() => toggle(entry.label)}
                className={`w-full group flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${hasActiveChild && !expanded
                    ? 'text-white bg-white/5'
                    : 'text-white hover:bg-white/10'
                  }`}>
                <span className="w-5 h-5 flex items-center justify-center shrink-0">{entry.icon}</span>
                <span className="flex-1 text-left">{entry.label}</span>
                <Chevron expanded={expanded} />
              </button>

              {/* Children (animated) */}
              <div className={`overflow-hidden transition-all duration-200 ease-in-out ${expanded ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="mt-0.5 space-y-0.5">
                  {entry.children.map(child => {
                    if (!canSee(child.href, allowedPaths)) return null;
                    const active = isActive(child.href);
                    return (
                      <Link key={child.href} href={child.href}
                        className={`flex items-center gap-2 pl-12 pr-4 py-2 rounded-lg text-sm transition-colors
                          ${active
                            ? 'text-white bg-white/10 border-l-[3px] border-[#C5A55A] pl-[45px]'
                            : 'text-white/70 hover:text-white hover:bg-white/10'
                          }`}>
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* User info + Sign Out */}
      <div className="px-4 py-4 border-t border-white/10">
        <p className="text-white text-sm font-medium truncate">{displayName}</p>
        <p className="text-white/50 text-xs mt-0.5 capitalize">{role.replace(/_/g, ' ')}</p>
        <button onClick={handleSignOut}
          className="mt-3 flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3l3-3m0 0l-3-3m3 3H9" />
          </svg>
          Sign Out
        </button>
      </div>
    </aside>
  );
}

/* ── SVG helpers ───────────────────────────────────────────────────────────── */

function I({ d }: { d: string }) {
  const paths = d.split(' M').map((p, i) => (i === 0 ? p : 'M' + p));
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      {paths.map((p, i) => <path key={i} strokeLinecap="round" strokeLinejoin="round" d={p} />)}
    </svg>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg className={`w-4 h-4 text-white/50 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}
