import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getSupabaseAdmin } from '@/lib/security/supabase-admin';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import { buildInviteHtml, buildInviteSubject } from '@/lib/domain/notifications/invite-email';

const ALLOWED_ROLES = ['super_admin', 'admin'];

const bodySchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  role: z.enum([
    'super_admin', 'admin', 'cs_admin', 'sales_manager',
    'sales_rep', 'title_officer', 'escrow_officer',
    'open_order_team', 'escrow_assistant', 'title_production', 'client',
  ]),
  branchId: z.number().int().positive().optional(),
  contactId: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  const { email, displayName, role, branchId, contactId } = parsed.data;

  try {
    const supabase = getSupabaseAdmin();

    const { data: user, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { display_name: displayName },
    });

    if (createError) {
      return NextResponse.json(
        { error: `Failed to create user: ${createError.message}` },
        { status: 422 },
      );
    }

    const userId = user.user.id;

    await db.insert(profiles).values({
      id: userId,
      email,
      displayName,
      role,
      branchId: branchId ?? null,
      contactId: contactId ?? null,
    });

    let magicLink: string | null = null;
    try {
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });
      magicLink = linkData?.properties?.action_link ?? null;
    } catch { /* magic link generation is best-effort */ }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://td-hub.pctitle.com';

    sendEmail({
      to: email,
      subject: buildInviteSubject(),
      html: buildInviteHtml(displayName, role, magicLink, appUrl),
    }).catch(() => {});

    return NextResponse.json({ success: true, userId }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
