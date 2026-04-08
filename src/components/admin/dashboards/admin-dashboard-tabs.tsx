'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AdminOpsDashboard } from './admin-ops-dashboard';
import { ManagerDashboard } from './manager-dashboard';
import { MonthSelector } from './month-selector';

const TABS = [
  { key: 'ops' as const, label: 'Operations', icon: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2' },
  { key: 'sales' as const, label: 'Sales Management', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
];

export function AdminDashboardTabs({ initialView }: { initialView: 'ops' | 'sales' }) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  const switchTo = useCallback((v: 'ops' | 'sales') => {
    setView(v);
    router.replace(`/dashboard?view=${v}`, { scroll: false });
  }, [router]);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => switchTo(tab.key)}
              className={`
                inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all
                ${view === tab.key
                  ? 'bg-white text-[#1B2A4A] shadow-sm'
                  : 'text-[#6B7280] hover:text-[#1A1A2E]'
                }
              `}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={tab.icon} />
              </svg>
              {tab.label}
            </button>
          ))}
        </div>
        <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
      </div>

      {view === 'ops' && <AdminOpsDashboard month={month} year={year} />}
      {view === 'sales' && <ManagerDashboard month={month} year={year} />}
    </>
  );
}
