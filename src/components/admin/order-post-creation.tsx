'use client';

import Link from 'next/link';

interface OrderPostCreationProps {
  orderId: number;
  fileNumber: string;
  titlePointTriggered: boolean;
  onCreateAnother: () => void;
}

const CHECK_ICON = (
  <svg className="h-5 w-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const CLOCK_ICON = (
  <svg className="h-5 w-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

export function OrderPostCreation({
  orderId, fileNumber, titlePointTriggered, onCreateAnother,
}: OrderPostCreationProps) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden shadow-sm">
      {/* Navy header */}
      <div className="bg-[#1B2A4A] px-6 py-4 flex items-center gap-3">
        <svg className="h-6 w-6 text-[#C5A55A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <h2 className="text-white font-semibold">Order Created — What&apos;s Next</h2>
          <p className="text-white/60 text-sm mt-0.5">Your order is being processed automatically</p>
        </div>
      </div>

      <div className="bg-white p-6">
        {/* File number */}
        <div className="flex items-center gap-3 mb-6 pb-5 border-b border-gray-100">
          <div className="h-10 w-10 rounded-lg bg-[#1B2A4A]/10 flex items-center justify-center">
            <svg className="h-5 w-5 text-[#1B2A4A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[#6B7280]">File Number</p>
            <Link href={`/orders/${orderId}`} className="text-lg font-semibold text-[#1B2A4A] hover:text-[#C5A55A] transition-colors">
              {fileNumber}
            </Link>
          </div>
        </div>

        {/* Checklist */}
        <div className="space-y-4 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Automated Tasks</p>

          <div className="flex items-start gap-3">
            {titlePointTriggered ? CHECK_ICON : CLOCK_ICON}
            <div>
              <p className="text-sm font-medium text-[#1A1A2E]">TitlePoint searches initiated</p>
              <p className="text-xs text-[#6B7280] mt-0.5">
                {titlePointTriggered
                  ? 'Geo, Tax, and Legal Vesting searches are running'
                  : 'Requires property address with state and county'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            {CLOCK_ICON}
            <div>
              <p className="text-sm font-medium text-[#1A1A2E]">Waiting for prelim report</p>
              <p className="text-xs text-[#6B7280] mt-0.5">SoftPro will deliver the prelim via webhook or scheduled fetch</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 text-[#C5A55A] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <div>
              <p className="text-sm font-medium text-[#1A1A2E]">Generate CPL when ready</p>
              <Link
                href={`/vendor-actions?tab=cpl&orderId=${orderId}`}
                className="text-xs text-[#C5A55A] hover:text-[#b3923e] font-medium transition-colors"
              >
                Go to CPL generator →
              </Link>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-[#1A1A2E]">View order details</p>
              <Link
                href={`/orders/${orderId}`}
                className="text-xs text-[#C5A55A] hover:text-[#b3923e] font-medium transition-colors"
              >
                Open order →
              </Link>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-5 border-t border-gray-100">
          <Link
            href={`/orders/${orderId}`}
            className="px-5 py-2.5 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors"
          >
            View Order
          </Link>
          <button
            onClick={onCreateAnother}
            className="px-5 py-2.5 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors"
          >
            Create Another Order
          </button>
        </div>
      </div>
    </div>
  );
}
