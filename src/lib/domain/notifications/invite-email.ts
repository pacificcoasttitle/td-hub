import {
  ORANGE_TINT,
  PCT_ORANGE,
  TEXT_MUTED,
  TEXT_PRIMARY,
  ctaButton,
  emailShell,
  esc,
} from '@/lib/domain/notifications/email-layout';

function roleDisplay(role: string): string {
  const cleaned = role.replace(/_/g, ' ').trim();
  if (cleaned.toLowerCase() === 'admin' || cleaned.toLowerCase() === 'super admin') {
    return 'Administrator';
  }
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildInviteSubject(): string {
  return "You're invited to PCT Transaction Desk";
}

export function buildInviteHtml(
  name: string,
  role: string,
  magicLink: string | null,
  appUrl: string,
): string {
  const displayName = name.trim() || 'there';
  const roleLabel = roleDisplay(role);
  const href = magicLink || appUrl;
  const cta = magicLink
    ? ctaButton('Accept Invitation', magicLink)
    : ctaButton('Open TD Hub', appUrl);

  const body = `<p style="margin:0 0 18px;color:${TEXT_PRIMARY};">Hi ${esc(displayName)},</p>
<p style="margin:0 0 22px;">You have been invited to PCT Transaction Desk with the role of <strong style="color:${TEXT_PRIMARY};">${esc(roleLabel)}</strong>.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${ORANGE_TINT};border-radius:14px;"><tr><td style="padding:22px;">
<p style="margin:0 0 7px;color:${PCT_ORANGE};font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Your workspace is ready</p>
<p style="margin:0 0 18px;color:${TEXT_PRIMARY};font-size:14px;line-height:1.55;">Accept the invitation to access orders, documents, and operational tools in TD Hub.</p>
${cta}
</td></tr></table>
<p style="margin:22px 0 0;color:${TEXT_MUTED};font-size:13px;">If you did not expect this invitation, you can safely ignore this email.</p>`;

  return emailShell({
    title: buildInviteSubject(),
    badge: 'Invitation',
    preheader: 'Your Pacific Coast Title transaction workspace is ready.',
    hero: {
      icon: '→',
      eyebrow: 'Account access',
      headline: 'Welcome to TD Hub.',
      subcopy: 'Your Pacific Coast Title transaction workspace is ready.',
    },
    bodyHtml: body,
  });
}
