'use client';

import { useState } from 'react';
import { UploadForm } from '@/components/admin/title-production/upload-form';
import { UploadHistory } from '@/components/admin/title-production/upload-history';

export default function TitleProductionPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1B2A4A]">Title Production</h1>
        <p className="text-sm text-[#6B7280] mt-1">Upload documents and send them to SoftPro for processing.</p>
      </div>

      <UploadForm onSuccess={() => setRefreshKey(k => k + 1)} />
      <UploadHistory refreshKey={refreshKey} />
    </div>
  );
}
