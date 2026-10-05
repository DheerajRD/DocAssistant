import { handler, HttpError, limit, readBounded } from '@/lib/http';
import { whatsappProvider, linkHash } from '@/lib/whatsapp';
import { env } from '@/lib/config';
import { adminClient, check } from '@/lib/supabase';
import { scrubQuestion } from '@/lib/assistant';
export const runtime = 'nodejs';
function xml(message?: string) {
  return new Response(
    message
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</Message></Response>`
      : '<?xml version="1.0" encoding="UTF-8"?><Response/>',
    { headers: { 'Content-Type': 'text/xml' } },
  );
}
export const POST = handler(async (req) => {
  const body = (await readBounded(req, 20000)).toString('utf8');
  const params = Object.fromEntries(new URLSearchParams(body));
  const provider = whatsappProvider();
  // Do not derive a signature URL from untrusted host/x-forwarded-* headers.
  if (
    !provider.validateWebhook(
      req.headers.get('x-twilio-signature') || '',
      env('TWILIO_WEBHOOK_URL'),
      params,
    )
  )
    throw new HttpError(403, 'Invalid webhook signature');
  const msg = provider.receiveWebhook(params);
  if (!msg) return xml();
  const db = adminClient();
  await limit(`wa:${linkHash(msg.phone)}`, 20, 300);
  const token = msg.text.match(/^VERIFY ([a-f0-9]{48})$/)?.[1];
  if (token) {
    const { data, error } = await db.rpc('verify_whatsapp', {
      p_hash: linkHash(token),
      p_phone: msg.phone,
    });
    check(error);
    return xml(
      data
        ? 'Your WhatsApp number is verified. You can now ask about your uploaded documents.'
        : 'Verification expired or did not match. Start again from your signed-in dashboard.',
    );
  }
  const { data: account, error } = await db
    .from('whatsapp_accounts')
    .select('user_id,verified_at,consent_at')
    .eq('phone', msg.phone)
    .maybeSingle();
  check(error);
  if (!account?.verified_at || !account.consent_at)
    return xml(
      'Verify your WhatsApp number in your signed-in dashboard before asking about documents.',
    );
  const { data: profile, error: p } = await db
    .from('profiles')
    .select('deleting_at')
    .eq('user_id', account.user_id)
    .single();
  check(p);
  if (profile?.deleting_at) return xml('Your account is being deleted.');
  if (/^STOP$/i.test(msg.text.trim())) {
    check(
      (
        await db
          .from('user_preferences')
          .update({ whatsapp_reminders: false })
          .eq('user_id', account.user_id)
      ).error,
    );
    return xml('WhatsApp reminders are turned off. You can enable them again in your dashboard.');
  }
  if (msg.hasMedia)
    return xml(
      'Document uploads through WhatsApp are not supported yet. Upload securely in your dashboard.',
    );
  if (!msg.text.trim())
    return xml('Try: My documents, What expires next?, or When does my CPT end?');
  // Durable queue avoids the webhook timeout; no document contents or full IDs are persisted here.
  const { error: q } = await db.rpc('queue_whatsapp_question', {
    p_user: account.user_id,
    p_phone: msg.phone,
    p_message: msg.id,
    p_question: scrubQuestion(msg.text),
  });
  check(q);
  return xml();
});
