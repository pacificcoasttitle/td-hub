import Link from 'next/link';
import { requireAdmin } from '@/lib/security/auth';

export const dynamic = 'force-dynamic';

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: '◫' },
  { label: 'Orders', href: '/orders', icon: '☰' },
  { label: 'Contacts & Companies', href: '/contacts', icon: '⊞' },
  { label: 'Documents', href: '/documents', icon: '⎘' },
  { label: 'Vendor Actions', href: '/vendor-actions', icon: '⚡' },
  { label: 'Jobs & Logs', href: '/jobs', icon: '⏱' },
  { label: 'Settings', href: '/settings', icon: '⚙' },
  { label: 'Users & Roles', href: '/users', icon: '⊕' },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();

  return (
    <div className="flex h-screen bg-[#F8F9FA]">
      {/* Sidebar */}
      <aside className="w-64 bg-[#1B2A4A] flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-white/10">
          <h1 className="text-white font-bold text-lg tracking-tight">
            TD Hub
          </h1>
          <p className="text-white/50 text-xs mt-0.5">Pacific Coast Title</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* User info */}
        <div className="px-4 py-4 border-t border-white/10">
          <p className="text-white/90 text-sm font-medium truncate">
            {session.displayName ?? session.email}
          </p>
          <p className="text-white/40 text-xs mt-0.5 capitalize">
            {session.role.replace('_', ' ')}
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
