'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ContactsTab } from '@/components/admin/contacts-tab';
import { CompaniesTab } from '@/components/admin/companies-tab';

type TabKey = 'contacts' | 'companies';

export default function ContactsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabKey) || 'contacts';

  function setTab(tab: TabKey) {
    router.push(`/contacts?tab=${tab}`);
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Contacts &amp; Companies</h1>
        <p className="text-sm text-[#6B7280] mt-1">Unified contact directory — replaces legacy entity pages</p>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {(['contacts', 'companies'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setTab(tab)}
              className={`pb-3 text-sm font-medium transition-colors relative capitalize ${
                activeTab === tab ? 'text-[#1B2A4A]' : 'text-[#6B7280] hover:text-[#1A1A2E]'
              }`}
            >
              {tab}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C5A55A] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'contacts' ? <ContactsTab /> : <CompaniesTab />}
    </div>
  );
}
