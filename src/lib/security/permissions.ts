import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import type { SessionUser } from './auth';

export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const ALL_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: '◫' },
  { label: 'Orders', href: '/orders', icon: '☰' },
  { label: 'Open Order (On Behalf)', href: '/orders/new-on-behalf', icon: '✦' },
  { label: 'Contacts & Companies', href: '/contacts', icon: '⊞' },
  { label: 'Documents', href: '/documents', icon: '⎘' },
  { label: 'Jobs & Logs', href: '/jobs', icon: '⏱' },
  { label: 'Settings', href: '/settings', icon: '⚙' },
  { label: 'Users & Roles', href: '/users', icon: '⊕' },
];

const NAV_LABELS_BY_ROLE: Record<string, string[]> = {
  super_admin: ALL_NAV_ITEMS.map((n) => n.label),
  admin: ALL_NAV_ITEMS.map((n) => n.label),
  cs_admin: ALL_NAV_ITEMS.filter((n) => n.label !== 'Settings').map((n) => n.label),
  sales_rep: ['Dashboard', 'Orders', 'Contacts & Companies'],
  title_officer: ['Dashboard', 'Orders', 'Documents'],
  escrow_officer: ['Dashboard', 'Orders', 'Documents'],
  open_order_team: ['Dashboard', 'Orders', 'Open Order (On Behalf)', 'Contacts & Companies'],
  escrow_assistant: ['Dashboard', 'Orders', 'Open Order (On Behalf)', 'Contacts & Companies'],
};

export function getNavItemsForRole(role: string): NavItem[] {
  const allowed = NAV_LABELS_BY_ROLE[role];
  if (!allowed) return [ALL_NAV_ITEMS[0]!];
  return ALL_NAV_ITEMS.filter((n) => allowed.includes(n.label));
}

// ─── Feature Access ─────────────────────────────────────────────────────────

type Feature = 'orders' | 'contacts' | 'documents' | 'jobs' | 'settings' | 'users' | 'dashboard';

const FEATURES_BY_ROLE: Record<string, Feature[]> = {
  super_admin: ['orders', 'contacts', 'documents', 'jobs', 'settings', 'users', 'dashboard'],
  admin: ['orders', 'contacts', 'documents', 'jobs', 'settings', 'users', 'dashboard'],
  cs_admin: ['orders', 'contacts', 'documents', 'jobs', 'users', 'dashboard'],
  sales_rep: ['orders', 'contacts', 'dashboard'],
  title_officer: ['orders', 'documents', 'dashboard'],
  escrow_officer: ['orders', 'documents', 'dashboard'],
  open_order_team: ['orders', 'contacts', 'dashboard'],
  escrow_assistant: ['orders', 'contacts', 'dashboard'],
};

export function canAccessFeature(role: string, feature: Feature): boolean {
  const allowed = FEATURES_BY_ROLE[role];
  return allowed ? allowed.includes(feature) : false;
}

// ─── Dashboard Redirect ─────────────────────────────────────────────────────

export function getDashboardRedirect(role: string): string | null {
  if (role === 'client') return '/client/orders';
  return null;
}

// ─── Per-Order Access ───────────────────────────────────────────────────────

const ALL_ORDERS_ROLES = new Set(['super_admin', 'admin', 'cs_admin', 'open_order_team']);
const ESCROW_ASSISTANT_ORDER_TYPES = new Set(['Title & Escrow', 'Escrow only']);

/**
 * Returns true if `session` is allowed to read/act on the order identified by
 * `orderId`. Returns false for missing orders so callers can respond with 404
 * and avoid leaking order existence to unauthorized roles.
 *
 * Routes should treat a `false` result as 404 (not 403) for all order-detail
 * endpoints — see the FIX-2 ticket rationale.
 */
export async function canAccessOrder(
  session: SessionUser,
  orderId: number,
): Promise<boolean> {
  if (!Number.isInteger(orderId) || orderId <= 0) return false;

  const [order] = await db
    .select({
      id: orders.id,
      orderType: orders.orderType,
      escrowOfficerId: orders.escrowOfficerId,
      titleOfficerId: orders.titleOfficerId,
      salesRepId: orders.salesRepId,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return false;

  if (ALL_ORDERS_ROLES.has(session.role)) return true;

  switch (session.role) {
    case 'escrow_assistant':
      return ESCROW_ASSISTANT_ORDER_TYPES.has(order.orderType ?? '');
    case 'escrow_officer':
      return session.contactId !== null && order.escrowOfficerId === session.contactId;
    case 'title_officer':
      return session.contactId !== null && order.titleOfficerId === session.contactId;
    case 'sales_rep':
    case 'sales_manager':
      // TODO: switch to validateSalesAccess() once it covers sales_manager
      // hierarchy + branch scopes. For now use direct ownership which matches
      // existing list-scoping behaviour for sales_rep.
      return session.contactId !== null && order.salesRepId === session.contactId;
    default:
      return false;
  }
}
