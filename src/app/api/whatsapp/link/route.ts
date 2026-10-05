import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { authenticated, handler, jsonBody, limit } from '@/lib/http';
import { adminClient, check } from '@/lib/supabase';
import { env } from '@/lib/config';
import { linkHash } from '@/lib/whatsapp';
export const POST = handler(async (req) => {
  const { user } = await authenticated(req, true);
  await limit(`link:${user.id}`, 5, 900);
  const { phone, consent } = z
    .object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/), consent: z.literal(true) })
    .parse(await jsonBody(req));
  const token = randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 10 * 60000).toISOString();
  const { error } = await adminClient()
    .from('whatsapp_link_challenges')
    .upsert({
      user_id: user.id,
      phone,
      token_hash: linkHash(token),
      expires_at: expires,
      consent_at: consent ? new Date().toISOString() : null,
    });
  check(error);
  const sender = env('TWILIO_WHATSAPP_FROM').replace('whatsapp:', '').replace('+', '');
  return NextResponse.json({
    url: `https://wa.me/${sender}?text=${encodeURIComponent(`VERIFY ${token}`)}`,
    expires_at: expires,
  });
});
export const DELETE = handler(async (req) => {
  const { user } = await authenticated(req, true);
  const db = adminClient();
  check((await db.from('whatsapp_accounts').delete().eq('user_id', user.id)).error);
  check((await db.from('whatsapp_link_challenges').delete().eq('user_id', user.id)).error);
  check(
    (await db.from('user_preferences').update({ whatsapp_reminders: false }).eq('user_id', user.id))
      .error,
  );
  return NextResponse.json({ ok: true });
});
