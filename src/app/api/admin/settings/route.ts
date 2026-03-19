import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { adminActivityLogs } from '@/lib/db/schema';
import {
  getAllSettings,
  updateSetting,
  isKnownSetting,
} from '@/lib/domain/settings/service';

const SETTINGS_ADMIN_ROLES = ['super_admin', 'admin'];

// ─── GET — all settings grouped by category ─────────────────────────────────

export async function GET() {
  const session = await getSession();
  if (!session || !SETTINGS_ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const allSettings = await getAllSettings();

    const grouped: Record<string, Array<{
      key: string;
      value: string;
      label: string;
      description: string;
      type: string;
    }>> = {};

    for (const s of allSettings) {
      if (!grouped[s.category]) grouped[s.category] = [];
      grouped[s.category].push({
        key: s.key,
        value: s.value,
        label: s.label,
        description: s.description,
        type: s.type,
      });
    }

    return NextResponse.json({ settings: grouped });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load settings', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}

// ─── PATCH — update a single setting ────────────────────────────────────────

const patchSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !SETTINGS_ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { key, value } = parsed.data;

  if (!isKnownSetting(key)) {
    return NextResponse.json(
      { error: `Unknown setting key: ${key}` },
      { status: 400 },
    );
  }

  try {
    await updateSetting(key, value);

    try {
      await db.insert(adminActivityLogs).values({
        userId: session.id,
        action: 'update_setting',
        entityType: 'setting',
        entityId: key,
        meta: { key, value },
      });
    } catch {
      // Don't fail the request if audit logging fails
    }

    return NextResponse.json({ success: true, key, value });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to update setting', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
