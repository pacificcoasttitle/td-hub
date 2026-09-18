'use client';

import { useState } from 'react';
import { ReportsListPage } from '@/components/admin/reports/reports-list-page';
import { NewReportModal } from '@/components/admin/reports/new-report-modal';

/**
 * Reports — farming reports and property profiles, in one list.
 *
 * Permission is the shell's: this page is reached through SidebarNav's
 * allowedPaths, and /api/reports re-checks the session on every request —
 * hiding a link is not a permission model. The one action here that can spend
 * lives behind the cost gate inside NewReportModal, and the server re-checks
 * both the flag and the role before it reaches the vendor.
 */
export default function ReportsPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  return (
    <>
      <ReportsListPage onNewReport={() => setModalOpen(true)} reloadToken={reloadToken} />
      {/* Mounted only while open, so every open starts from an empty form. */}
      {modalOpen ? (
        <NewReportModal
          onClose={() => setModalOpen(false)}
          // Created, not sent. The row appears; delivery is a separate act.
          onCreated={() => setReloadToken((t) => t + 1)}
        />
      ) : null}
    </>
  );
}
