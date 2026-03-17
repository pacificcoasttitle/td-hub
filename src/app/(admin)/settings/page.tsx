'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface Branch {
  id: number; code: string; name: string;
  city: string | null; state: string | null; phone: string | null;
  isActive: boolean;
}

interface NotificationTemplate {
  id: number;
  name: string;
  eventType: string;
  subject: string;
  bodyHtml: string;
  isActive: boolean;
}

type TabKey = 'branches' | 'templates' | 'system';

const TABS: [TabKey, string][] = [
  ['branches', 'Branches'],
  ['templates', 'Notification Templates'],
  ['system', 'System Settings'],
];

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabKey) || 'branches';

  function setTab(tab: TabKey) { router.push(`/settings?tab=${tab}`); }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">Settings</h1>
        <p className="text-sm text-[#6B7280] mt-1">Branches, notification templates, and system configuration</p>
      </div>
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === key ? 'text-[#1B2A4A]' : 'text-[#6B7280] hover:text-[#1A1A2E]'}`}>
              {label}
              {activeTab === key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1B2A4A] rounded-full" />}
            </button>
          ))}
        </nav>
      </div>
      {activeTab === 'branches' && <BranchesTab />}
      {activeTab === 'templates' && <NotificationTemplatesTab />}
      {activeTab === 'system' && <SystemSettingsTab />}
    </div>
  );
}

/* ── Branches Tab ──────────────────────────────────────────────────────────── */

function BranchesTab() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/branches')
      .then((res) => { if (!res.ok) throw new Error(`Failed (${res.status})`); return res.json(); })
      .then((d) => setBranches(d.branches))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {error ? (
        <div className="p-8 text-center"><p className="text-red-600 font-medium">{error}</p></div>
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
                    <tr key={i}>{Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
                    ))}</tr>
                  ))
                : branches.map((b) => (
                    <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-medium text-[#1B2A4A]">{b.code}</td>
                      <td className="px-4 py-3 font-medium text-[#1A1A2E]">{b.name}</td>
                      <td className="px-4 py-3 text-[#1A1A2E]">{b.city ?? '—'}</td>
                      <td className="px-4 py-3 text-[#1A1A2E]">{b.state ?? '—'}</td>
                      <td className="px-4 py-3 text-[#6B7280]">{b.phone ?? '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><StatusDot active={b.isActive} /></td>
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

/* ── Notification Templates Tab ────────────────────────────────────────────── */

function NotificationTemplatesTab() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NotificationTemplate | null>(null);

  useEffect(() => {
    fetch('/api/admin/notification-templates')
      .then(r => { if (!r.ok) throw new Error(`Failed (${r.status})`); return r.json(); })
      .then(d => setTemplates(d.templates ?? []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? (
          <div className="p-8 text-center"><p className="text-red-600 font-medium">{error}</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Event Type</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Subject</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 4 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
                      ))}</tr>
                    ))
                  : templates.map((t) => (
                      <tr key={t.id} onClick={() => setSelected(t)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-4 py-3 font-medium text-[#1A1A2E]">{t.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex px-2 py-0.5 bg-gray-100 rounded text-xs font-medium text-[#4B5563]">{t.eventType}</span>
                        </td>
                        <td className="px-4 py-3 text-[#4B5563] max-w-[300px] truncate">{t.subject}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 text-xs ${t.isActive ? 'text-green-700' : 'text-gray-400'}`}>
                            <span className={`h-2 w-2 rounded-full ${t.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                            {t.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
            {!loading && templates.length === 0 && (
              <div className="p-12 text-center">
                <p className="text-[#1A1A2E] font-medium">No notification templates</p>
                <p className="text-sm text-[#6B7280] mt-1">Templates will appear here once configured.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {selected && <TemplatePreviewModal template={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

/* ── Template Preview Modal ────────────────────────────────────────────────── */

function TemplatePreviewModal({ template, onClose }: { template: NotificationTemplate; onClose: () => void }) {
  const [showPreview, setShowPreview] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-[#1A1A2E]">{template.name}</h2>
            <span className="inline-flex px-2 py-0.5 bg-gray-100 rounded text-xs font-medium text-[#4B5563] mt-1">{template.eventType}</span>
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A2E]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Subject</p>
            <p className="text-sm text-[#1A1A2E] bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 font-mono">{template.subject}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Status</p>
            <span className={`inline-flex items-center gap-1.5 text-xs ${template.isActive ? 'text-green-700' : 'text-gray-400'}`}>
              <span className={`h-2 w-2 rounded-full ${template.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
              {template.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Email Body</p>
              <button onClick={() => setShowPreview(!showPreview)}
                className="text-xs font-medium text-[#1B2A4A] hover:text-[#243658]">
                {showPreview ? 'Hide Preview' : 'Preview HTML'}
              </button>
            </div>
            {showPreview ? (
              <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                <iframe
                  ref={iframeRef}
                  srcDoc={template.bodyHtml}
                  title="Template preview"
                  sandbox=""
                  className="w-full h-80 border-0"
                />
              </div>
            ) : (
              <pre className="text-xs text-[#1A1A2E] bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono">
                {template.bodyHtml || 'No HTML body'}
              </pre>
            )}
          </div>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs text-amber-700">
              Variables like <code className="font-mono bg-amber-100 px-1 rounded">{'{firstName}'}</code>, <code className="font-mono bg-amber-100 px-1 rounded">{'{fileNumber}'}</code> will be replaced with actual values when the email is sent.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium border border-gray-200 text-[#4B5563] rounded-lg hover:bg-gray-50 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── System Settings Tab ──────────────────────────────────────────────────── */

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

/* ── Shared ────────────────────────────────────────────────────────────────── */

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-green-500' : 'bg-gray-300'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}
