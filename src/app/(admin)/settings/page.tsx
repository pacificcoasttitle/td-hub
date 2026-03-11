'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Branch {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  isActive: boolean;
}

type TabKey = 'branches' | 'system';

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabKey) || 'branches';

  function setTab(tab: TabKey) {
    router.push(`/settings?tab=${tab}`);
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Settings</h1>
        <p className="text-sm text-[#6B7280] mt-1">Branches and system configuration</p>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {([['branches', 'Branches'], ['system', 'System Settings']] as const).map(([key, label]) => (
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

      {activeTab === 'branches' ? <BranchesTab /> : <SystemSettingsTab />}
    </div>
  );
}

// ─── Branches Tab ───────────────────────────────────────────────────────────

function BranchesTab() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/branches')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load branches (${res.status})`);
        return res.json();
      })
      .then((d) => setBranches(d.branches))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {error ? (
        <div className="p-8 text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-sm text-[#6B7280] mt-1">Check your connection and try again.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Code</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Name</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280]">City</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280]">State</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
                        </td>
                      ))}
                    </tr>
                  ))
                : branches.map((b) => (
                    <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-medium text-[#1B2A4A]">{b.code}</td>
                      <td className="px-4 py-3 font-medium text-[#1A1A2E]">{b.name}</td>
                      <td className="px-4 py-3 text-[#1A1A2E]">{b.city ?? '—'}</td>
                      <td className="px-4 py-3 text-[#1A1A2E]">{b.state ?? '—'}</td>
                      <td className="px-4 py-3 text-[#6B7280]">{b.phone ?? '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusDot active={b.isActive} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && branches.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-[#1A1A2E] font-medium">No branches configured</p>
              <p className="text-sm text-[#6B7280] mt-1">Run the seed script to populate branches.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── System Settings Tab ────────────────────────────────────────────────────

function SystemSettingsTab() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="p-12 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
          <svg className="h-6 w-6 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <p className="text-[#1A1A2E] font-medium">Feature Flags &amp; Configuration</p>
        <p className="text-sm text-[#6B7280] mt-1">Coming soon — toggle features and manage system settings.</p>
      </div>
    </div>
  );
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-green-500' : 'bg-gray-300'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}
