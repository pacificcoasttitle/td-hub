import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getSupabaseAdmin } from '@/lib/security/supabase-admin';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { sendEmail } from '@/lib/integrations/sendgrid/client';

const ALLOWED_ROLES = ['super_admin', 'admin'];

const bodySchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  role: z.enum([
    'super_admin', 'admin', 'cs_admin', 'sales_manager',
    'sales_rep', 'title_officer', 'escrow_officer',
    'open_order_team', 'title_production', 'client',
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
      subject: "You've been invited to PCT Transaction Desk",
      html: buildInviteHtml(displayName, role, magicLink, appUrl),
    }).catch(() => {});

    return NextResponse.json({ success: true, userId }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function buildInviteHtml(name: string, role: string, magicLink: string | null, appUrl: string): string {
  const linkHtml = magicLink
    ? `<p style="margin:24px 0;"><a href="${magicLink}" style="display:inline-block;padding:12px 24px;background:#1B2A4A;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Accept Invitation</a></p>`
    : `<p>Visit <a href="${appUrl}">${appUrl}</a> to sign in.</p>`;

  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
      <div style="border-bottom:3px solid #1B2A4A;padding-bottom:12px;margin-bottom:20px;">
        <h2 style="margin:0;color:#1B2A4A;">Pacific Coast Title Company</h2>
        <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">Transaction Desk</p>
      </div>
      <p>Hi ${name},</p>
      <p>You've been invited to PCT Transaction Desk as a <strong>${role.replace(/_/g, ' ')}</strong>.</p>
      ${linkHtml}
      <p style="font-size:13px;color:#6b7280;">If you didn't expect this invitation, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="font-size:11px;color:#9ca3af;">Pacific Coast Title Company — TD Hub</p>
    </div>`;
}
