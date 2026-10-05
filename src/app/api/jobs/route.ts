import { NextResponse } from 'next/server';
import { handler, HttpError } from '@/lib/http';
import { adminClient, check } from '@/lib/supabase';
import { env } from '@/lib/config';
import { constantTimeMatch } from '@/lib/whatsapp';
import { runJobs, runReminders } from '@/lib/jobs';
export const runtime = 'nodejs';
export const maxDuration = 300;
export const GET = handler(async (req) => {
  const secret = env('CRON_SECRET');
  if (
    secret.length < 32 ||
    !constantTimeMatch(req.headers.get('authorization') || '', `Bearer ${secret}`)
  )
    throw new HttpError(401, 'Unauthorized worker request');
  const db = adminClient();
  const jobs = await runJobs(db);
  const reminders = await runReminders(db);
  // Purge short-lived challenges/rate limits and operational metadata on a bounded retention policy.
  check(
    (await db.from('whatsapp_link_challenges').delete().lt('expires_at', new Date().toISOString()))
      .error,
  );
  check(
    (
      await db
        .from('rate_limits')
        .delete()
        .lt('window_start', new Date(Date.now() - 86400000).toISOString())
    ).error,
  );
  for (const table of ['whatsapp_messages', 'ai_conversations', 'audit_logs'])
    check(
      (
        await db
          .from(table)
          .delete()
          .lt('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
      ).error,
    );
  return NextResponse.json({ jobs, reminders });
});
