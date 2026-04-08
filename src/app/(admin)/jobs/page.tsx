'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IntegrationHealth } from '@/components/admin/ops/integration-health';
import { CronStatus } from '@/components/admin/ops/cron-status';
import { TessaStatus } from '@/components/admin/ops/tessa-status';
import { NotificationStatus } from '@/components/admin/ops/notification-status';
import { SyncStatus } from '@/components/admin/ops/sync-status';
import { VendorLogsTab } from '@/components/admin/vendor-logs-tab';
import { WebhooksTab } from '@/components/admin/webhooks-tab';

type TabKey = 'dashboard' | 'logs' | 'webhooks';

const TABS: [TabKey, string][] = [
  ['dashboard', 'Dashboard'],
  ['logs', 'Detailed Logs'],
  ['webhooks', 'Webhooks'],
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function OperationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabKey) || 'dashboard';

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  function setTab(tab: TabKey) {
    router.push(tab === 'dashboard' ? '/jobs' : `/jobs?tab=${tab}`);
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1A2E]">Operations</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Monitor integrations, cron jobs, and system health
          </p>
        </div>

        {activeTab === 'dashboard' && (
          <div className="flex items-center gap-2">
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:ring-1 focus:ring-[#1B2A4A] focus:border-[#1B2A4A]"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:ring-1 focus:ring-[#1B2A4A] focus:border-[#1B2A4A]"
            >
              <option value={2025}>2025</option>
              <option value={2026}>2026</option>
            </select>
          </div>
        )}
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-3 text-sm font-medium transition-colors relative ${
                activeTab === key ? 'text-[#1B2A4A]' : 'text-[#6B7280] hover:text-[#1A1A2E]'
              }`}
            >
              {label}
              {activeTab === key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1B2A4A] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Integration health</h2>
            <IntegrationHealth month={month} year={year} />
          </section>
          <CronStatus month={month} year={year} />
          <TessaStatus month={month} year={year} />
          <NotificationStatus month={month} year={year} />
          <SyncStatus month={month} year={year} />
        </div>
      )}

      {activeTab === 'logs' && <VendorLogsTab />}
      {activeTab === 'webhooks' && <WebhooksTab />}
    </div>
  );
}
