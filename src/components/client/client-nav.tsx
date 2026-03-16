'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/client/dashboard', label: 'Dashboard' },
  { href: '/client/orders', label: 'My Orders' },
  { href: '/client/orders/new', label: 'Open Order' },
];

export function ClientNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 overflow-x-auto -mb-px">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || (item.href !== '/client/dashboard' && pathname.startsWith(item.href) && item.href !== '/client/orders/new');
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`inline-flex items-center px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors min-h-[44px] ${
              active
                ? 'border-[#1B2A4A] text-[#1B2A4A]'
                : 'border-transparent text-[#6B7280] hover:text-[#1A1A2E] hover:border-gray-300'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
