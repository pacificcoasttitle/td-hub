'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, BarChart3, TrendingUp, Users, DollarSign,
  Briefcase, Trophy, LogOut, Menu, X,
} from 'lucide-react';
import { handleSignOut } from '@/lib/security/sign-out';

type Role = 'sales_rep' | 'sales_manager';

interface NavItem { label: string; href: string; icon: React.ReactNode }

const ICON_CLS = 'h-4 w-4 shrink-0';

const BASE_ITEMS: NavItem[] = [
  { label: 'Dashboard',          href: '/sales/dashboard',          icon: <LayoutDashboard className={ICON_CLS} /> },
  { label: 'Production History', href: '/sales/production-history', icon: <BarChart3 className={ICON_CLS} /> },
  { label: 'Trends',             href: '/sales/trends',             icon: <TrendingUp className={ICON_CLS} /> },
  { label: 'Summary',            href: '/sales/summary',            icon: <Users className={ICON_CLS} /> },
  { label: 'Commission',         href: '/sales/commission',         icon: <DollarSign className={ICON_CLS} /> },
];

const RANKING: NavItem = { label: 'Ranking', href: '/sales/ranking', icon: <Trophy className={ICON_CLS} /> };

const ORDER_ITEMS: NavItem[] = [
  { label: 'Orders', href: '/sales/orders', icon: <Briefcase className={ICON_CLS} /> },
];

function buildNav(role: Role): { top: NavItem[]; orders: NavItem[] } {
  if (role === 'sales_manager') {
    const top = [...BASE_ITEMS];
    const summaryIdx = top.findIndex(i => i.label === 'Summary');
    top.splice(summaryIdx + 1, 0, RANKING);
    return { top, orders: ORDER_ITEMS };
  }
  return { top: BASE_ITEMS, orders: ORDER_ITEMS };
}

const ROLE_LABELS: Record<Role, string> = {
  sales_rep: 'Sales Rep',
  sales_manager: 'Sales Manager',
};

interface Props { role: Role; userName: string }

export function SalesSidebar({ role, userName }: Props) {
  const pathname = usePathname();
  const { top, orders } = buildNav(role);
  const [mobileOpen, setMobileOpen] = useState(false);

  const linkCls = (href: string) => {
    const active = pathname === href;
    return [
      'flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors rounded-r-md',
      active
        ? 'border-l-[3px] border-[#F26B2B] bg-white/5 text-white'
        : 'border-l-[3px] border-transparent text-white/70 hover:bg-white/5 hover:text-white',
    ].join(' ');
  };

  const sidebar = (
    <div className="flex flex-col h-full bg-[#1B2A4A] w-[240px]">
      {/* Brand */}
      <div className="px-5 pt-6 pb-5 border-b border-white/10">
        <span className="text-white text-sm font-semibold tracking-wide">Pacific Coast Title</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5">
        {top.map(item => (
          <Link key={item.href} href={item.href} className={linkCls(item.href)}
            onClick={() => setMobileOpen(false)}>
            {item.icon}<span>{item.label}</span>
          </Link>
        ))}

        <div className="my-2 mx-4 border-t border-white/10" />

        {orders.map(item => (
          <Link key={item.href} href={item.href} className={linkCls(item.href)}
            onClick={() => setMobileOpen(false)}>
            {item.icon}<span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white text-sm font-medium truncate max-w-[140px]">{userName}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            role === 'sales_manager'
              ? 'bg-[#F26B2B]/80 text-white'
              : 'bg-white/10 text-white'
          }`}>
            {ROLE_LABELS[role]}
          </span>
        </div>
        <button onClick={handleSignOut}
          className="flex items-center gap-2 text-xs text-white/50 hover:text-white transition-colors">
          <LogOut className="h-3.5 w-3.5" /> Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden md:block shrink-0 h-screen sticky top-0">
        {sidebar}
      </aside>

      {/* Mobile trigger */}
      <div className="md:hidden fixed top-3 left-3 z-50">
        <button onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="p-2 rounded-lg bg-[#1B2A4A] text-white shadow-lg">
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="relative h-full">{sidebar}</div>
          <button onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="absolute top-3 right-3 p-2 text-white/80 hover:text-white z-50">
            <X className="h-5 w-5" />
          </button>
          <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  );
}
