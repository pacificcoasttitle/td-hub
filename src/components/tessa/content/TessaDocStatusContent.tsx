'use client'

import type { ExtractedDocumentStatus } from '@/lib/tessa/tessa-types'

interface Props {
  docStatus: ExtractedDocumentStatus
}

export function TessaDocStatusContent({ docStatus }: Props) {
  return (
    <div className="space-y-3">
      {/* Completeness */}
      <div className="flex items-center gap-2">
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          docStatus.appears_complete
            ? 'bg-green-100 text-green-700'
            : 'bg-yellow-100 text-yellow-700'
        }`}>
          {docStatus.appears_complete ? '✓' : '?'}
        </span>
        <span className={`text-sm font-medium ${
          docStatus.appears_complete ? 'text-green-700' : 'text-yellow-700'
        }`}>
          {docStatus.appears_complete ? 'Document appears complete' : 'Document may be incomplete'}
        </span>
      </div>

      {/* Metadata */}
      {(docStatus.document_date || docStatus.order_number) && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 flex flex-wrap gap-x-6 gap-y-1">
          {docStatus.document_date && (
            <div>
              <span className="text-xs text-gray-500 block">Document Date</span>
              <span className="text-sm font-medium text-gray-800">{docStatus.document_date}</span>
            </div>
          )}
          {docStatus.order_number && (
            <div>
              <span className="text-xs text-gray-500 block">Order Number</span>
              <span className="text-sm font-medium text-gray-800">{docStatus.order_number}</span>
            </div>
          )}
        </div>
      )}

      {/* Missing sections */}
      {docStatus.missing_sections && docStatus.missing_sections.length > 0 && (
        <div>
          <span className="text-xs font-semibold text-red-600 uppercase tracking-wide block mb-1">Missing Sections</span>
          <ul className="space-y-0.5">
            {docStatus.missing_sections.map((s, i) => (
              <li key={i} className="text-sm text-red-700 flex gap-2">
                <span className="text-red-400 flex-shrink-0">–</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Notes */}
      {docStatus.notes && (
        <div>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Notes</span>
          <p className="text-sm text-gray-700">{docStatus.notes}</p>
        </div>
      )}
    </div>
  )
}
