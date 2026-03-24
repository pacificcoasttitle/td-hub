'use client';

import { useRouter } from 'next/navigation';
import { ClientSelector } from '@/components/admin/client-selector';
import { PropertyConfirmModal } from '@/components/shared/property-confirm-modal';
import { OrderSummaryPanel } from '@/components/admin/OrderSummaryPanel';
import { SECTION, SH } from '@/components/admin/quick-entry/types';
import { useQuickEntry } from '@/components/admin/quick-entry/use-quick-entry';
import {
  PropertySection, TransactionSection, PartiesSection,
} from '@/components/admin/quick-entry/sections';

export default function HubNewOrderPage() {
  const s = useQuickEntry();
  const router = useRouter();

  if (s.result?.type === 'success') {
    const fn = s.result.fileNumber;
    if (fn) {
      router.replace(`/hub/order-confirm/${encodeURIComponent(fn)}`);
      return <div className="flex items-center justify-center py-20"><p className="text-sm text-[#6B7280]">Redirecting to confirmation…</p></div>;
    }
    router.replace('/hub');
    return null;
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
          <TransactionSection s={s} />

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
              orderType={s.orderType}
            />
            {s.client && (
              <div className="mt-3 px-4 py-3 bg-[#F26B2B]/10 border border-[#F26B2B]/20 rounded-lg">
                <p className="text-sm font-medium text-[#1A1A2E]">Opening on behalf of: {s.client.fullName ?? s.client.companyName ?? 'Client'}</p>
                <p className="text-xs text-[#6B7280]">{[s.client.email, s.client.phone].filter(Boolean).join(' · ')}</p>
              </div>
            )}
          </div>

          <PropertySection s={s} />
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
