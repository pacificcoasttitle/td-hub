import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import { buildAllSampleEmails } from '@/lib/domain/notifications/sample-templates';

const ADMIN_ROLES = ['super_admin', 'admin'];
const SAMPLE_RECIPIENT = 'ghernandez@pct.com';

export async function POST() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = [];
  for (const template of buildAllSampleEmails()) {
    const subject = `[SAMPLE] ${template.subject}`;
    const result = await sendEmail({
      to: SAMPLE_RECIPIENT,
      subject,
      html: template.html,
      text: template.text,
    });

    if (!result.success || !result.data) {
      return NextResponse.json({
        success: false,
        error: result.error?.message ?? `Failed to send ${template.key}`,
        sent: results,
        failedTemplate: template.key,
      }, { status: 502 });
    }

    results.push({
      key: template.key,
      label: template.label,
      to: SAMPLE_RECIPIENT,
      subject,
      messageId: result.data.messageId,
    });
  }

  return NextResponse.json({
    success: true,
    sent: results,
    count: results.length,
  });
}
