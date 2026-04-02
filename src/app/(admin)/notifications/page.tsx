'use client';

import { useState } from 'react';
import { ConfigTab } from '@/components/admin/notifications/config-tab';
import { LogTab } from '@/components/admin/notifications/log-tab';

type Tab = 'config' | 'log';

export default function NotificationsPage() {
  const [tab, setTab] = useState<Tab>('config');

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1B2A4A]">Notifications</h1>
        <p className="text-sm text-[#6B7280] mt-1">Manage notification types, channels, and view delivery logs.</p>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {([['config', 'Configuration'], ['log', 'Log']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`pb-3 text-sm font-medium transition-colors relative ${tab === key ? 'text-[#1B2A4A]' : 'text-[#6B7280] hover:text-[#1A1A2E]'}`}>
              {label}
              {tab === key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#F26B2B] rounded-full" />}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'config' && <ConfigTab />}
      {tab === 'log' && <LogTab />}
    </div>
  );
}
