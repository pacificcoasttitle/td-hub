import { redirect } from 'next/navigation';
import { getSession } from '@/lib/security/auth';
import { ClientProfilePage } from '@/components/sales/clients/client-profile-page';

export const dynamic = 'force-dynamic';

const SALES_ROLES = ['sales_rep', 'sales_manager'];

export default async function SalesClientProfileRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!SALES_ROLES.includes(session.role)) redirect('/dashboard');

  const { id } = await params;
  const clientId = Number(id);
  if (!Number.isInteger(clientId) || clientId <= 0) redirect('/sales/clients');

  // The list's own state travels in the query string, so Back can rebuild the
  // exact list the rep left — same search, filters, page and rep.
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

  return (
    <ClientProfilePage
      clientId={clientId}
      role={session.role as 'sales_rep' | 'sales_manager'}
      repId={one(sp.repId)}
      backQuery={one(sp.back) ?? ''}
    />
  );
}
