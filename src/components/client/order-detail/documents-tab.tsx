import { CATEGORY_LABELS, formatDate, formatFileSize } from './helpers';

interface Document {
  id: number;
  filename: string;
  category: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export function DocumentsTab({ documents }: { documents: Document[] }) {
  if (documents.length === 0) {
    return (
      <div className="p-6 text-center py-12">
        <svg className="mx-auto h-8 w-8 text-[#9CA3AF] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm text-[#6B7280]">No documents available for this order.</p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Document</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Category</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Size</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Date</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-[#6B7280] uppercase tracking-wider" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {documents.map((doc) => (
              <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#9CA3AF] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="font-medium text-[#1A1A2E] truncate max-w-xs">{doc.filename}</span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-[#374151]">
                    {CATEGORY_LABELS[doc.category ?? ''] ?? doc.category ?? '—'}
                  </span>
                </td>
                <td className="px-5 py-4 text-[#6B7280] whitespace-nowrap">{formatFileSize(doc.sizeBytes)}</td>
                <td className="px-5 py-4 text-[#6B7280] whitespace-nowrap">{formatDate(doc.createdAt)}</td>
                <td className="px-5 py-4 text-right">
                  <a
                    href={`/api/documents/${doc.id}/download`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-[#1B2A4A] hover:underline"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="sm:hidden divide-y divide-gray-100">
        {documents.map((doc) => (
          <div key={doc.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#1A1A2E] truncate">{doc.filename}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-[#374151]">
                    {CATEGORY_LABELS[doc.category ?? ''] ?? doc.category ?? '—'}
                  </span>
                  <span className="text-xs text-[#6B7280]">{formatFileSize(doc.sizeBytes)}</span>
                </div>
                <p className="text-xs text-[#6B7280] mt-1">{formatDate(doc.createdAt)}</p>
              </div>
              <a
                href={`/api/documents/${doc.id}/download`}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#1B2A4A] bg-[#1B2A4A]/5 rounded-lg hover:bg-[#1B2A4A]/10 transition-colors min-h-[44px] flex-shrink-0"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </a>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
