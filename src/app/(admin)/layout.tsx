import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/security/auth';

export const dynamic = 'force-dynamic';

interface NavItem { label: string; href: string; icon: string; }
interface NavSection { heading: string; items: NavItem[]; }
type NavEntry = NavItem | NavSection;

function isSection(e: NavEntry): e is NavSection { return 'heading' in e; }

const ALL_NAV: NavEntry[] = [
  { label: 'Dashboard', href: '/dashboard', icon: '◫' },
  { label: 'Hub', href: '/hub', icon: '▣' },
  { label: 'Orders', href: '/orders', icon: '☰' },
  { label: 'Quick Entry', href: '/orders/quick-entry', icon: '⚡' },
  { label: 'Open Order (On Behalf)', href: '/orders/new-on-behalf', icon: '✦' },
  {
    heading: 'Contacts',
    items: [
      { label: 'Title Officers', href: '/contacts/title-officers', icon: '○' },
      { label: 'Escrow Officers', href: '/contacts/escrow-officers', icon: '○' },
      { label: 'Sales Reps', href: '/contacts/sales-reps', icon: '○' },
      { label: 'Agents', href: '/contacts/agents', icon: '◦' },
      { label: 'Escrow Cos', href: '/contacts/escrow-companies', icon: '◦' },
      { label: 'Lenders', href: '/contacts/lenders', icon: '◦' },
      { label: 'Mortgage Brokers', href: '/contacts/mortgage-brokers', icon: '◦' },
      { label: 'Companies', href: '/contacts/companies', icon: '◈' },
    ],
  },
  { label: 'Documents', href: '/documents', icon: '⎘' },
  { label: 'Vendor Actions', href: '/vendor-actions', icon: '⚡' },
  { label: 'Jobs & Logs', href: '/jobs', icon: '⏱' },
  { label: 'Settings', href: '/settings', icon: '⚙' },
  { label: 'Users & Roles', href: '/users', icon: '⊕' },
];

const NAV_BY_ROLE: Record<string, string[]> = {
  super_admin: ['/dashboard', '/hub', '/orders', '/contacts', '/documents', '/vendor-actions', '/jobs', '/settings', '/users'],
  admin: ['/dashboard', '/hub', '/orders', '/contacts', '/documents', '/vendor-actions', '/jobs', '/settings', '/users'],
  cs_admin: ['/dashboard', '/hub', '/orders', '/contacts', '/documents', '/vendor-actions', '/jobs'],
  sales_rep: ['/dashboard', '/orders', '/contacts'],
  title_officer: ['/dashboard', '/orders', '/documents', '/vendor-actions'],
  escrow_officer: ['/dashboard', '/orders', '/documents', '/vendor-actions'],
  open_order_team: ['/hub', '/orders', '/orders/quick-entry', '/orders/new-on-behalf', '/contacts'],
};

const ALLOWED_ROLES = Object.keys(NAV_BY_ROLE);

function isAllowed(href: string, allowedPaths: string[]): boolean {
  return allowedPaths.some(p => href === p || href.startsWith(p + '/'));
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'client') redirect('/client/orders');
  if (!ALLOWED_ROLES.includes(session.role)) redirect('/login');

  const allowedPaths = NAV_BY_ROLE[session.role] ?? [];

  return (
    <div className="flex h-screen bg-[#F8F9FA]">
      <aside className="w-64 bg-[#1B2A4A] flex flex-col shrink-0">
        <div className="px-6 py-5 border-b border-white/10">
          <h1 className="text-white font-bold text-lg tracking-tight">TD Hub</h1>
          <p className="text-white/50 text-xs mt-0.5">Pacific Coast Title</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {ALL_NAV.map((entry, idx) => {
            if (isSection(entry)) {
              const visibleItems = entry.items.filter(i => isAllowed(i.href, allowedPaths));
              if (visibleItems.length === 0) return null;
              return (
                <div key={idx} className="pt-4 pb-1">
                  <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-1">{entry.heading}</p>
                  <div className="space-y-0.5">
                    {visibleItems.map(item => (
                      <Link key={item.href} href={item.href}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/10 transition-colors pl-5">
                        <span className="text-xs w-4 text-center opacity-50">{item.icon}</span>
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            }
            if (!isAllowed(entry.href, allowedPaths)) return null;
            return (
              <Link key={entry.href} href={entry.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                <span className="text-base w-5 text-center">{entry.icon}</span>
                {entry.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-white/10">
          <p className="text-white/90 text-sm font-medium truncate">{session.displayName ?? session.email}</p>
          <p className="text-white/40 text-xs mt-0.5 capitalize">{session.role.replace(/_/g, ' ')}</p>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
