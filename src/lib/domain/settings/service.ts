import { db } from '@/lib/db/client';
import { settings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// ─── Settings Registry ──────────────────────────────────────────────────────
// The DB table only stores key, value (jsonb), description, updatedAt.
// Label, category, type, and defaults live here so other services can look
// them up without a DB round-trip and so we have a strict allowlist.

export interface SettingDef {
  key: string;
  label: string;
  description: string;
  category: string;
  type: 'boolean' | 'string' | 'number';
  defaultValue: string;
}

export const SETTINGS_REGISTRY: SettingDef[] = [
  // ── TitlePoint ──
  {
    key: 'titlepoint_shut_off',
    label: 'TitlePoint Shut Off',
    description: 'When enabled, skips all TitlePoint searches (LV, Tax, Grant Deed) during order creation. Orders still submit to SoftPro and confirmation emails send without document attachments.',
    category: 'TitlePoint',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'titlepoint_vesting_doc_filter',
    label: 'Vesting Document Type Filter',
    description: 'When enabled, only considers Grant Deed, Quit Claim Deed, and Intrafamily Transfer document types for the vesting instrument number extraction.',
    category: 'TitlePoint',
    type: 'boolean',
    defaultValue: 'true',
  },
  {
    key: 'enable_lv_with_address_apn',
    label: 'LV With Address And APN',
    description: 'When enabled, Legal Vesting pre-init requests include Address1 and City alongside Pin in the legacy parameter string.',
    category: 'TitlePoint',
    type: 'boolean',
    defaultValue: 'true',
  },
  // ── Email ──
  {
    key: 'open_order_confirmation_enabled',
    label: 'Open Order Confirmation Email',
    description: 'When enabled, sends confirmation email with TitlePoint documents after order creation.',
    category: 'Email',
    type: 'boolean',
    defaultValue: 'true',
  },
  {
    key: 'closed_order_email_purchase_enabled',
    label: 'Closed Order Email (Purchase)',
    description: 'When enabled, sends notification email when a Purchase order is closed.',
    category: 'Email',
    type: 'boolean',
    defaultValue: 'true',
  },
  {
    key: 'closed_order_email_refinance_enabled',
    label: 'Closed Order Email (Refinance)',
    description: 'When enabled, sends notification email when a Refinance order is closed.',
    category: 'Email',
    type: 'boolean',
    defaultValue: 'true',
  },
  // ── SiteX ──
  {
    key: 'sitex_environment',
    label: 'SiteX Environment',
    description: 'Which SiteX API environment to use. UAT for testing, Production for live.',
    category: 'SiteX',
    type: 'string',
    defaultValue: 'uat',
  },
  // ── System ──
  {
    key: 'maintenance_mode',
    label: 'Maintenance Mode',
    description: 'When enabled, shows maintenance message to non-admin users.',
    category: 'System',
    type: 'boolean',
    defaultValue: 'false',
  },
];

const REGISTRY_MAP = new Map(SETTINGS_REGISTRY.map((s) => [s.key, s]));

// ─── In-Memory Cache (60s TTL) ─────────────────────────────────────────────

let _cache: Map<string, string> | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60_000;

function isCacheValid(): boolean {
  return _cache !== null && Date.now() - _cacheTs < CACHE_TTL_MS;
}

async function loadCache(): Promise<Map<string, string>> {
  if (isCacheValid()) return _cache!;

  const rows = await db.select({ key: settings.key, value: settings.value }).from(settings);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.key, valueToString(row.value));
  }
  _cache = map;
  _cacheTs = Date.now();
  return map;
}

export function invalidateCache(): void {
  _cache = null;
  _cacheTs = 0;
}

function valueToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const cache = await loadCache();
  if (cache.has(key)) return cache.get(key)!;

  const def = REGISTRY_MAP.get(key);
  if (def) return def.defaultValue;

  return null;
}

export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  const cache = await loadCache();
  const result: Record<string, string | null> = {};
  for (const key of keys) {
    if (cache.has(key)) {
      result[key] = cache.get(key)!;
    } else {
      const def = REGISTRY_MAP.get(key);
      result[key] = def?.defaultValue ?? null;
    }
  }
  return result;
}

export interface SettingRow {
  key: string;
  value: string;
  label: string;
  description: string;
  category: string;
  type: 'boolean' | 'string' | 'number';
}

export async function getAllSettings(): Promise<SettingRow[]> {
  const cache = await loadCache();

  return SETTINGS_REGISTRY.map((def) => ({
    key: def.key,
    value: cache.get(def.key) ?? def.defaultValue,
    label: def.label,
    description: def.description,
    category: def.category,
    type: def.type,
  }));
}

export async function updateSetting(key: string, value: string): Promise<void> {
  const def = REGISTRY_MAP.get(key);
  if (!def) throw new Error(`Unknown setting key: ${key}`);

  const [existing] = await db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  if (existing) {
    await db
      .update(settings)
      .set({ value, updatedAt: new Date() })
      .where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({
      key,
      value,
      description: def.description,
    });
  }

  invalidateCache();
}

export function isKnownSetting(key: string): boolean {
  return REGISTRY_MAP.has(key);
}
