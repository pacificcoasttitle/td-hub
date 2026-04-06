'use client';

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';

interface Report {
  id: number;
  date: string;
  type: string;
  inputOptions: string | null;
  downloadUrl: string;
}

export default function ReportsPage() {
  const [data, setData] = useState<Report[] | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sales/reports')
      .then(r => {
        if (r.status === 404) { setNotReady(true); return null; }
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(d => { if (d) setData(d.reports ?? []); })
      .catch(() => setNotReady(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Reports</h1>

      {loading && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-5 py-4 border-b border-gray-100 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {!loading && notReady && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
          <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Report downloads coming soon.</p>
          <p className="text-sm text-gray-400 mt-1">County Reports, Sales Activity, and FAR Reports will appear here when available.</p>
        </div>
      )}

      {!loading && !notReady && data && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Date</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Report Type</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Input Options</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500 w-24">Download</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 text-gray-700 whitespace-nowrap">
                    {new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-3 font-medium text-gray-900">{r.type}</td>
                  <td className="px-5 py-3 text-gray-500">{r.inputOptions ?? '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <a href={r.downloadUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center justify-center h-8 w-8 rounded-lg hover:bg-gray-100 text-[#1B2A4A]">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && (
            <div className="p-12 text-center"><p className="text-gray-500">No reports available.</p></div>
          )}
        </div>
      )}
    </div>
  );
}
