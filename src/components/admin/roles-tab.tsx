'use client';

import { useEffect, useState } from 'react';
import { SkeletonRow } from './shared-table';

interface Role {
  id: number;
  name: string;
  description: string | null;
  permissions: string[];
  createdAt: string;
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-800',
  admin: 'bg-indigo-100 text-indigo-800',
  cs_admin: 'bg-purple-100 text-purple-800',
  sales_rep: 'bg-sky-100 text-sky-800',
  title_officer: 'bg-teal-100 text-teal-800',
  escrow_officer: 'bg-amber-100 text-amber-800',
  client: 'bg-gray-100 text-gray-700',
};

export function RolesTab() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/roles')
      .then((res) => { if (!res.ok) throw new Error(`Failed to load roles (${res.status})`); return res.json(); })
      .then((d) => setRoles(d.roles))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {error ? (
        <div className="p-8 text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-sm text-[#6B7280] mt-1">Check your connection and try again.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Role Name</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Description</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Permissions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={3} />)
                : roles.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap"><RoleBadge role={r.name} /></td>
                      <td className="px-4 py-3 text-[#1A1A2E] max-w-md">
                        {r.description || <span className="text-[#6B7280]">No description</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.permissions.length > 0 ? (
                          <span className="text-sm text-[#1A1A2E] font-medium">{r.permissions.length} permission{r.permissions.length !== 1 ? 's' : ''}</span>
                        ) : (
                          <span className="text-[#6B7280] text-sm">None defined</span>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && roles.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-[#1A1A2E] font-medium">No roles configured</p>
              <p className="text-sm text-[#6B7280] mt-1">Run the seed script to populate roles.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>{role.replace(/_/g, ' ')}</span>;
}
