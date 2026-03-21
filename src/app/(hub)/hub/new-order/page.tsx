'use client';

import { useRouter } from 'next/navigation';
import { ClientSelector } from '@/components/admin/client-selector';
import { PropertyConfirmModal } from '@/components/shared/property-confirm-modal';
import { OrderSummaryPanel } from '@/components/admin/OrderSummaryPanel';
import { SECTION, SH } from '@/components/admin/quick-entry/types';
import { useQuickEntry } from '@/components/admin/quick-entry/use-quick-entry';
import {
  PropertySection, SellerSection, TransactionSection, PartiesSection,
} from '@/components/admin/quick-entry/sections';

export default function HubNewOrderPage() {
  const s = useQuickEntry();
  const router = useRouter();

  if (s.result?.type === 'success' && s.result.orderId) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-[#1B2A4A] px-6 py-5 flex items-center gap-3">
            <svg className="h-6 w-6 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div>
              <p className="text-white font-semibold">Order Created</p>
              <p className="text-white/60 text-sm">{s.result.message}</p>
            </div>
          </div>
          <div className="p-6 flex gap-3">
            <button onClick={() => router.push('/hub')}
              className="flex-1 inline-flex items-center justify-center px-5 py-3 text-sm font-semibold bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] transition-colors h-11">
              Back to Hub
            </button>
            <button onClick={() => { s.setResult(null); window.scrollTo(0, 0); }}
              className="flex-1 inline-flex items-center justify-center px-5 py-3 text-sm font-medium border border-gray-200 text-[#4B5563] rounded-lg hover:bg-gray-50 transition-colors h-11">
              Create Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto pb-32">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]">New Order</h1>
        <p className="text-sm text-[#6B7280] mt-1">Create an order on behalf of a client — all fields in one view.</p>
      </div>

      <div className="flex flex-col xl:flex-row gap-6">
        {/* Left: Form (70%) */}
        <div className="xl:w-[70%] min-w-0">
          {/* Client Selector */}
          <div className={SECTION}>
            <p className={SH}>
              <svg className="h-5 w-5 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              Client
            </p>
            <ClientSelector
              selected={s.client}
              onSelect={s.setClient}
              onClear={() => s.setClient(null)}
            />
            {s.client && (
              <div className="mt-3 px-4 py-3 bg-[#F26B2B]/10 border border-[#F26B2B]/20 rounded-lg">
                <p className="text-sm font-medium text-[#1A1A2E]">Opening on behalf of: {s.client.fullName ?? s.client.companyName ?? 'Client'}</p>
                <p className="text-xs text-[#6B7280]">{[s.client.email, s.client.phone].filter(Boolean).join(' · ')}</p>
              </div>
            )}
          </div>

          <PropertySection s={s} />
          <SellerSection s={s} />
          <TransactionSection s={s} />
          <PartiesSection s={s} />
        </div>

        {/* Right: Order Summary (30%) */}
        <div className="xl:w-[30%]">
          <OrderSummaryPanel s={s} />
        </div>
      </div>

      {/* Fixed Submit Bar — full width for hub (no sidebar) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-8 py-4 flex items-center justify-between z-30">
        <div>
          {s.result?.type === 'error' && <p className="text-sm text-red-600">{s.result.message}</p>}
        </div>
        <button
          onClick={s.handleSubmit}
          disabled={s.submitting}
          className="px-8 py-3 text-sm font-semibold bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors h-11 inline-flex items-center gap-2"
        >
          {s.submitting ? 'Creating Order…' : 'Create Order'}
        </button>
      </div>

      <PropertyConfirmModal
        open={s.showConfirmModal}
        address={s.pendingAddress ?? { street: '', city: '', state: '', zip: '' }}
        onConfirm={s.handleConfirm}
        onNoMatch={() => { s.setShowConfirmModal(false); s.setNoMatchMsg('Property not found — enter details manually.'); }}
        onReject={() => { s.setShowConfirmModal(false); s.setStreet(''); s.setCity(''); s.setState(''); s.setZip(''); }}
        accentColor="#F26B2B"
      />
    </div>
  );
}
