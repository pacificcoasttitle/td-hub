export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const ALL_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: '◫' },
  { label: 'Orders', href: '/orders', icon: '☰' },
  { label: 'Contacts & Companies', href: '/contacts', icon: '⊞' },
  { label: 'Documents', href: '/documents', icon: '⎘' },
  { label: 'Vendor Actions', href: '/vendor-actions', icon: '⚡' },
  { label: 'Jobs & Logs', href: '/jobs', icon: '⏱' },
  { label: 'Settings', href: '/settings', icon: '⚙' },
  { label: 'Users & Roles', href: '/users', icon: '⊕' },
];

const NAV_LABELS_BY_ROLE: Record<string, string[]> = {
  super_admin: ALL_NAV_ITEMS.map((n) => n.label),
  admin: ALL_NAV_ITEMS.map((n) => n.label),
  cs_admin: ALL_NAV_ITEMS.filter((n) => n.label !== 'Settings').map((n) => n.label),
  sales_rep: ['Dashboard', 'Orders', 'Contacts & Companies'],
  title_officer: ['Dashboard', 'Orders', 'Documents', 'Vendor Actions'],
  escrow_officer: ['Dashboard', 'Orders', 'Documents', 'Vendor Actions'],
};

export function getNavItemsForRole(role: string): NavItem[] {
  const allowed = NAV_LABELS_BY_ROLE[role];
  if (!allowed) return [ALL_NAV_ITEMS[0]!];
  return ALL_NAV_ITEMS.filter((n) => allowed.includes(n.label));
}

// ─── Feature Access ─────────────────────────────────────────────────────────

type Feature = 'orders' | 'contacts' | 'documents' | 'vendor_actions' | 'jobs' | 'settings' | 'users' | 'dashboard';

const FEATURES_BY_ROLE: Record<string, Feature[]> = {
  super_admin: ['orders', 'contacts', 'documents', 'vendor_actions', 'jobs', 'settings', 'users', 'dashboard'],
  admin: ['orders', 'contacts', 'documents', 'vendor_actions', 'jobs', 'settings', 'users', 'dashboard'],
  cs_admin: ['orders', 'contacts', 'documents', 'vendor_actions', 'jobs', 'users', 'dashboard'],
  sales_rep: ['orders', 'contacts', 'dashboard'],
  title_officer: ['orders', 'documents', 'vendor_actions', 'dashboard'],
  escrow_officer: ['orders', 'documents', 'vendor_actions', 'dashboard'],
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
