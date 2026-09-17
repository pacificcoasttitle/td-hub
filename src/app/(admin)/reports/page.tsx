'use client';

import { useState } from 'react';
import { ReportsListPage } from '@/components/admin/reports/reports-list-page';

/**
 * Reports — farming reports and property profiles, in one list.
 *
 * The New Report modal is the next piece; until it lands the button says so
 * rather than opening something empty. Permission is the shell's: this page is
 * reached through SidebarNav's allowedPaths, and /api/reports re-checks the
 * session on every request — hiding a link is not a permission model.
 */
export default function ReportsPage() {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      {notice ? (
        <div className="px-6 pt-6">
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-[#6B7280]">{notice}</div>
        </div>
      ) : null}
      <ReportsListPage onNewReport={() => setNotice('The New Report picker is being built. A property profile is the first type it will offer.')} />
    </>
  );
}
