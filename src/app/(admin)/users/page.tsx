'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { UsersTab } from '@/components/admin/users-tab';
import { RolesTab } from '@/components/admin/roles-tab';

type TabKey = 'users' | 'roles';

export default function UsersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabKey) || 'users';

  function setTab(tab: TabKey) {
    router.push(`/users?tab=${tab}`);
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Users &amp; Roles</h1>
        <p className="text-sm text-[#6B7280] mt-1">Manage system users and role definitions</p>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {([['users', 'Users'], ['roles', 'Roles']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-3 text-sm font-medium transition-colors relative ${
                activeTab === key ? 'text-[#1B2A4A]' : 'text-[#6B7280] hover:text-[#1A1A2E]'
              }`}
            >
              {label}
              {activeTab === key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C5A55A] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'users' ? <UsersTab /> : <RolesTab />}
    </div>
  );
}
