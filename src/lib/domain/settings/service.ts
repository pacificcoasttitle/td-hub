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
    key: 'open_order_confirmation_timeout_minutes',
    label: 'Open Order Confirmation Timeout (minutes)',
    description: 'If TitlePoint legal_vesting/tax/grant_deed are not all completed within this many minutes, enqueue the confirmation email without the missing documents instead of waiting forever.',
    category: 'Email',
    type: 'number',
    defaultValue: '10',
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
  // ── Notification Shutoffs ──
  {
    key: 'lookback_sync_shut_off',
    label: 'Look-back Sync Shut Off',
    description: 'When enabled, the order look-back sync stops taking new work on its next run. Takes effect without a deploy; the cursor is preserved so it resumes where it stopped.',
    category: 'Notifications',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'party_wizard_invite_enabled',
    label: 'Party Wizard Invite Sending',
    description: 'Master switch for the party-collection invite job. OFF by default and OFF on any fresh environment or reset row: the job refuses to send and records the refusal rather than resuming on its own. Turning it ON starts emailing escrow officers on the next cron run (Mon–Fri 16:00 UTC). Links already sent keep working regardless. Use the dry run on the Operations page to see exactly who would be emailed before turning this on.',
    category: 'Notifications',
    type: 'boolean',
    defaultValue: 'false',
  },
  // Abuse limits for the UNAUTHENTICATED party wizard page. Windows are fixed
  // in party-wizard-abuse.ts (10 minutes for volume, 60 for breadth); only the
  // counts are tunable here. They start as reasoned estimates rather than
  // measured values because the feature has never sent, so the first real week
  // of traffic is expected to move them — which is why they are settings.
  // A value below 1 is ignored and the compiled-in default is used, so a
  // fat-fingered 0 cannot black out the page.
  {
    key: 'party_wizard_get_limit_per_ip',
    label: 'Party Wizard Page Loads Per IP (10 min)',
    description: 'Maximum party wizard page loads one IP address may make in 10 minutes using valid links. A real recipient opening a forwarded link, reloading while typing, and coming back on a phone uses well under 10; an office behind one NAT with several live links might reach 30. Above this the page shows a calm "try again shortly" card. Default 40.',
    category: 'Notifications',
    type: 'number',
    defaultValue: '40',
  },
  {
    key: 'party_wizard_post_limit_per_ip',
    label: 'Party Wizard Submissions Per IP (10 min)',
    description: 'Maximum party wizard form submissions one IP address may make in 10 minutes. A legitimate party submits once, or twice to fix a typo. Sits just above the existing per-link cap of 5 so it only bites when one host submits across several different links. Default 6.',
    category: 'Notifications',
    type: 'number',
    defaultValue: '6',
  },
  {
    key: 'party_wizard_invalid_limit_per_ip',
    label: 'Party Wizard Invalid Links Per IP (60 min)',
    description: 'Maximum party wizard links with a bad signature one IP address may present in 60 minutes. Tokens are HMAC-signed, so a bad signature means the link was truncated in the forward or is being guessed. Tripping this blocks that IP from ALL party wizard traffic for the hour, valid links included — this is the strongest abuse signal available and is acted on hardest. Keep it low. Default 6.',
    category: 'Notifications',
    type: 'number',
    defaultValue: '6',
  },
  {
    key: 'party_wizard_distinct_tokens_per_ip',
    label: 'Party Wizard Distinct Links Per IP (60 min)',
    description: 'Maximum DIFFERENT party wizard links one IP address may open in 60 minutes. Catches the case the volume limits cannot: a compromised mailbox holding many real links, opened slowly. Honest breadth is 1, or about 3 for an office handling several files at once. Reloading the same link does not count again. Default 10.',
    category: 'Notifications',
    type: 'number',
    defaultValue: '10',
  },
  {
    key: 'party_wizard_invite_max_per_run',
    label: 'Party Wizard Invite — Max Emails Per Run',
    description: 'Total ceiling on how many invite emails a single run may send, on top of the permanent per-recipient cap of 2 and the one-ask-per-property rule. Set to 5 for the first pilot so the first real sends are a handful of readable emails rather than a backlog cleared in one morning. Orders held back by this ceiling are reported as "Held — run cap" in the dry run and stay eligible on the next run; nothing about being held marks them as invited. Raise it once the first sends are confirmed to land and get forwarded. 0 stops sending without touching the master switch.',
    category: 'Notifications',
    type: 'number',
    defaultValue: '5',
  },
  {
    key: 'prelim_summary_shut_off',
    label: 'Prelim Summary Shut Off',
    description: 'When enabled, prelim summary webhooks are received but not processed.',
    category: 'Notifications',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'recording_confirmation_shut_off',
    label: 'Recording Confirmation Shut Off',
    description: 'When enabled, recording confirmation milestones are logged but no SMS/email sent.',
    category: 'Notifications',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'disburse_funds_shut_off',
    label: 'Disburse Funds Shut Off',
    description: 'When enabled, disbursement milestones are logged but no SMS/email sent.',
    category: 'Notifications',
    type: 'boolean',
    defaultValue: 'false',
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
  // ── TESSA (AI Prelim) ──
  {
    key: 'tessa_prelim_enabled',
    label: 'AI Prelim Analysis (TESSA)',
    description: 'When OFF, the AI Prelim feature is hidden from all users: the "Prelim Summary" / "Regenerate Summary" buttons do not render, no new analysis is triggered from any path, and the manual analyze endpoint rejects. Existing stored analyses are NOT removed. Default OFF. (Env flags TESSA_AUTO_ANALYSIS_ENABLED / TESSA_MANUAL_ANALYSIS_ENABLED remain a master-kill backstop: if either env flag is OFF, TESSA stays off regardless of this toggle.)',
    category: 'TESSA',
    type: 'boolean',
    defaultValue: 'false',
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
let _seedPromise: Promise<void> | null = null;

// ─── In-Memory Cache (60s TTL) ─────────────────────────────────────────────

let _cache: Map<string, string> | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60_000;

function isCacheValid(): boolean {
  return _cache !== null && Date.now() - _cacheTs < CACHE_TTL_MS;
}

async function loadCache(): Promise<Map<string, string>> {
  if (isCacheValid()) return _cache!;

  await ensureSettingsSeeded();

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

function parseValueForStorage(def: SettingDef, value: string): string | boolean | number {
  if (def.type === 'boolean') {
    return value.toLowerCase() === 'true';
  }
  if (def.type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return value;
}

async function ensureSettingsSeeded(): Promise<void> {
  if (_seedPromise) {
    await _seedPromise;
    return;
  }

  _seedPromise = (async () => {
    const existingRows = await db.select({ key: settings.key }).from(settings);
    const existingKeys = new Set(existingRows.map((row) => row.key));
    const missingDefs = SETTINGS_REGISTRY.filter((def) => !existingKeys.has(def.key));

    if (missingDefs.length === 0) return;

    await db.insert(settings).values(
      missingDefs.map((def) => ({
        key: def.key,
        value: parseValueForStorage(def, def.defaultValue),
        description: def.description,
      })),
    );
  })();

  try {
    await _seedPromise;
  } finally {
    _seedPromise = null;
  }
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
  const parsedValue = parseValueForStorage(def, value);

  const [existing] = await db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  if (existing) {
    await db
      .update(settings)
      .set({ value: parsedValue, updatedAt: new Date() })
      .where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({
      key,
      value: parsedValue,
      description: def.description,
    });
  }

  invalidateCache();
}

export function isKnownSetting(key: string): boolean {
  return REGISTRY_MAP.has(key);
}
