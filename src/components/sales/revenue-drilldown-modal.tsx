'use client';

interface Props {
  monthName: string;
  year: number;
  onClose: () => void;
}

export function RevenueDrilldownModal({ monthName, year, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{monthName} {year} — Revenue</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-8 text-center">
          <p className="text-sm text-gray-500">Detailed order breakdown will be available in the next update.</p>
        </div>
        <div className="px-6 py-3 border-t border-gray-200 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
