import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticated, handler, jsonBody, limit, HttpError } from '@/lib/http';
import { adminClient, check } from '@/lib/supabase';
import { loadDocuments } from '@/lib/data';
import { syncReminders } from '@/lib/reminders';
import { offsets } from '@/lib/documents';
export const GET = handler(async (req) => {
  const { user } = await authenticated(req);
  const db = adminClient();
  const values = await Promise.all([
    db
      .from('profiles')
      .select('display_name,immigration_category,timezone,deleting_at')
      .eq('user_id', user.id)
      .single(),
    db
      .from('user_preferences')
      .select('reminder_offsets,whatsapp_reminders')
      .eq('user_id', user.id)
      .single(),
    db
      .from('whatsapp_accounts')
      .select('phone,verified_at,consent_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    db
      .from('reminders')
      .select('id,label,deadline,offset_days,scheduled_date,state')
      .eq('user_id', user.id)
      .neq('state', 'cancelled')
      .order('scheduled_date')
      .limit(100),
    db
      .from('reminder_history')
      .select('id,outcome,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  for (const v of values) check(v.error);
  return NextResponse.json({
    email: user.email,
    profile: values[0].data,
    preferences: values[1].data,
    whatsapp: values[2].data,
    reminders: values[3].data,
    history: values[4].data,
  });
});
const schema = z.object({
  display_name: z.string().trim().min(1).max(100),
  timezone: z.string().max(80),
  reminder_offsets: z
    .array(
      z
        .number()
        .int()
        .refine((n) => (offsets as readonly number[]).includes(n)),
    )
    .max(7),
  whatsapp_reminders: z.boolean(),
});
export const PATCH = handler(async (req) => {
  const { user } = await authenticated(req, true);
  await limit(`settings:${user.id}`, 20);
  const body = schema.parse(await jsonBody(req));
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: body.timezone });
  } catch {
    throw new HttpError(400, 'Invalid time zone');
  }
  const db = adminClient();
  if (body.whatsapp_reminders) {
    const { data, error } = await db
      .from('whatsapp_accounts')
      .select('verified_at,consent_at')
      .eq('user_id', user.id)
      .maybeSingle();
    check(error);
    if (!data?.verified_at || !data.consent_at)
      throw new HttpError(400, 'Verify your WhatsApp number and consent first');
  }
  check(
    (
      await db
        .from('profiles')
        .update({
          display_name: body.display_name,
          timezone: body.timezone,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .is('deleting_at', null)
    ).error,
  );
  check(
    (
      await db
        .from('user_preferences')
        .update({
          reminder_offsets: [...new Set(body.reminder_offsets)],
          whatsapp_reminders: body.whatsapp_reminders,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
    ).error,
  );
  await syncReminders(db, user.id, await loadDocuments(db, user.id));
  return NextResponse.json({ ok: true });
});
