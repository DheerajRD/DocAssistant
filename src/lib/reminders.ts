import 'server-only';
import { DB, check } from './supabase';
import { deadlines, DocRecord, reminderDate } from './documents';

export function planReminders(docs: DocRecord[], chosen: number[], today: string) {
  return deadlines(docs)
    .filter((d) => d.reviewed)
    .flatMap((d) =>
      chosen.map((offset) => ({
        document_id: d.documentId,
        field_name: d.field,
        label: d.label,
        deadline: d.date,
        offset_days: offset,
        scheduled_date: reminderDate(d.date, offset),
      })),
    )
    .filter((r) => r.scheduled_date >= today);
}
export async function syncReminders(db: DB, userId: string, docs: DocRecord[]) {
  const { data: preferences, error } = await db
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();
  check(error);
  const { data: profile, error: p } = await db
    .from('profiles')
    .select('timezone,deleting_at')
    .eq('user_id', userId)
    .single();
  check(p);
  if (!profile || !preferences || profile.deleting_at) return;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: profile.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const reminders = planReminders(docs, preferences.reminder_offsets, today);
  const { error: r } = await db.rpc('sync_reminder_plan', { p_user: userId, p_plan: reminders });
  check(r);
}
