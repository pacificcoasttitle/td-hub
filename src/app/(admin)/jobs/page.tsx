'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { JobsTab } from '@/components/admin/jobs-tab';
import { VendorLogsTab } from '@/components/admin/vendor-logs-tab';
import { WebhooksTab } from '@/components/admin/webhooks-tab';

type TabKey = 'jobs' | 'logs' | 'webhooks';

const TABS: [TabKey, string][] = [
  ['jobs', 'Jobs'],
  ['logs', 'Vendor Logs'],
  ['webhooks', 'Webhooks'],
];

export default function JobsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabKey) || 'jobs';

  function setTab(tab: TabKey) {
    router.push(`/jobs?tab=${tab}`);
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Jobs &amp; Logs</h1>
        <p className="text-sm text-[#6B7280] mt-1">Monitor sync jobs, vendor API activity, and incoming webhooks</p>
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

      {activeTab === 'jobs' && <JobsTab />}
      {activeTab === 'logs' && <VendorLogsTab />}
      {activeTab === 'webhooks' && <WebhooksTab />}
    </div>
  );
}
