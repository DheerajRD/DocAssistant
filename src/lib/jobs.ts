import 'server-only';
import { DB, check } from './supabase';
import { extractDocument } from './extract';
import { askAssistant } from './assistant';
import { whatsappProvider } from './whatsapp';
import { productName, appUrl } from './config';
interface Job {
  id: string;
  user_id: string;
  document_id: string | null;
  kind: 'extract' | 'whatsapp' | 'delete_document' | 'delete_account';
  payload: Record<string, string>;
  claim_token: string;
}
async function status(db: DB, job: Job, value: string) {
  check(
    (
      await db
        .from('documents')
        .update({ status: value })
        .eq('id', job.document_id)
        .eq('user_id', job.user_id)
        .is('deleted_at', null)
    ).error,
  );
}
async function extract(db: DB, job: Job) {
  const { data: doc, error } = await db
    .from('documents')
    .select('*')
    .eq('id', job.document_id)
    .eq('user_id', job.user_id)
    .is('deleted_at', null)
    .maybeSingle();
  check(error);
  if (!doc) return;
  await status(db, job, 'extracting_text');
  const { data: blob, error: s } = await db.storage
    .from('immigration-documents')
    .download(doc.storage_path);
  check(s);
  if (!blob) throw new Error('Document unavailable');
  const bytes = Buffer.from(await blob.arrayBuffer());
  // Vision/PDF transcription, classification and extraction happen in one structured model call.
  await status(db, job, 'identifying_document');
  const parsed = await extractDocument(bytes, doc.mime_type);
  await status(db, job, 'extracting_information');
  const { data: active, error: a } = await db
    .from('jobs')
    .select('state,claim_token')
    .eq('id', job.id)
    .single();
  check(a);
  if (active?.state !== 'running' || active.claim_token !== job.claim_token) return;
  const { error: e } = await db.rpc('save_document_fields', {
    p_user: job.user_id,
    p_document: job.document_id,
    p_type: parsed.extraction.document_type,
    p_fields: parsed.fields,
    p_confidence: parsed.confidence,
    p_raw: { ...parsed.extraction, invalid_fields: parsed.invalid },
    p_review: false,
  });
  check(e);
}
async function deleteDocument(db: DB, job: Job) {
  // Path comes from service-only queue, never from a client-provided deletion path.
  const { data: doc, error } = await db
    .from('documents')
    .select('storage_path,deleted_at')
    .eq('id', job.document_id)
    .eq('user_id', job.user_id)
    .maybeSingle();
  check(error);
  const path = doc?.storage_path || job.payload.storage_path;
  if (doc && !doc.deleted_at) throw new Error('Deletion was not requested');
  if (path) {
    if (!path.startsWith(`${job.user_id}/`)) throw new Error('Storage ownership mismatch');
    check((await db.storage.from('immigration-documents').remove([path])).error);
  }
  check(
    (await db.from('documents').delete().eq('id', job.document_id).eq('user_id', job.user_id))
      .error,
  );
}
async function deleteAccount(db: DB, job: Job) {
  const { data: profile, error } = await db
    .from('profiles')
    .select('deleting_at')
    .eq('user_id', job.user_id)
    .maybeSingle();
  check(error);
  if (!profile) return;
  if (!profile.deleting_at) throw new Error('Deletion was not requested');
  // Also remove orphan objects from partially failed uploads. Listing names are UUIDs only.
  while (true) {
    const { data: objects, error: s } = await db.storage
      .from('immigration-documents')
      .list(job.user_id, { limit: 100 });
    check(s);
    if (!objects?.length) break;
    check(
      (
        await db.storage
          .from('immigration-documents')
          .remove(objects.map((o) => `${job.user_id}/${o.name}`))
      ).error,
    );
  }
  // Cascades remove structured rows, messages, chats, reminders, raw extractions, jobs and audits.
  check((await db.auth.admin.deleteUser(job.user_id)).error);
}
async function whatsapp(db: DB, job: Job) {
  const { data: account, error } = await db
    .from('whatsapp_accounts')
    .select('*')
    .eq('user_id', job.user_id)
    .maybeSingle();
  check(error);
  if (!account?.verified_at || !account.consent_at) return;
  const { data: profile, error: p } = await db
    .from('profiles')
    .select('deleting_at')
    .eq('user_id', job.user_id)
    .single();
  check(p);
  if (!profile || profile.deleting_at) return;
  if (
    !account.last_inbound_at ||
    Date.now() - new Date(account.last_inbound_at).valueOf() > 23 * 3600000
  )
    return;
  const question = job.payload.question;
  const result = await askAssistant(db, job.user_id, question, 'whatsapp');
  // Recheck mapping after AI routing so unlink/relink cannot deliver to stale phone.
  const { data: stillLinked, error: l } = await db
    .from('whatsapp_accounts')
    .select('phone')
    .eq('user_id', job.user_id)
    .eq('phone', account.phone)
    .maybeSingle();
  check(l);
  if (!stillLinked) return;
  await whatsappProvider().sendMessage(account.phone, result.answer);
  check(
    (
      await db
        .from('whatsapp_messages')
        .update({ intent: result.intent })
        .eq('user_id', job.user_id)
        .eq('provider_message_id', job.payload.message_id)
    ).error,
  );
}
export async function runJobs(db: DB) {
  const { data, error } = await db.rpc('claim_jobs', { p_limit: 3 });
  check(error);
  const results: Record<string, number> = { done: 0, failed: 0, uncertain: 0 };
  for (const job of (data || []) as Job[]) {
    let state = 'done';
    try {
      if (job.kind === 'extract') await extract(db, job);
      else if (job.kind === 'delete_document') await deleteDocument(db, job);
      else if (job.kind === 'delete_account') await deleteAccount(db, job);
      else await whatsapp(db, job);
    } catch {
      state = job.kind === 'whatsapp' ? 'uncertain' : 'failed';
      if (job.kind === 'extract') await status(db, job, 'failed');
      // Error bodies from AI/Twilio/storage may include PII: only record state, never payload.
    }
    check(
      (
        await db
          .from('jobs')
          .update({
            state,
            payload: state === 'done' || job.kind === 'whatsapp' ? {} : job.payload,
          })
          .eq('id', job.id)
          .eq('claim_token', job.claim_token)
          .eq('state', 'running')
      ).error,
    );
    results[state] = (results[state] || 0) + 1;
  }
  return results;
}
interface Reminder {
  id: string;
  user_id: string;
  document_id: string;
  label: string;
  deadline: string;
  offset_days: number;
  claim_token: string;
}
export async function runReminders(db: DB) {
  const { data, error: r } = await db.rpc('claim_reminders', { p_limit: 20 });
  check(r);
  let submitted = 0;
  for (const reminder of (data || []) as Reminder[]) {
    const { data: account, error: a } = await db
      .from('whatsapp_accounts')
      .select('phone,verified_at,consent_at')
      .eq('user_id', reminder.user_id)
      .maybeSingle();
    check(a);
    if (!account?.verified_at || !account.consent_at) {
      check(
        (
          await db
            .from('reminders')
            .update({ state: 'cancelled' })
            .eq('id', reminder.id)
            .eq('claim_token', reminder.claim_token)
        ).error,
      );
      continue;
    }
    let outcome = 'submitted';
    let messageId: string | null = null;
    try {
      messageId = await whatsappProvider().sendTemplate(account.phone, {
        '1': productName,
        '2': reminder.label,
        '3': reminder.deadline,
        '4': String(reminder.offset_days),
        '5': `${appUrl()}/`,
      });
      submitted++;
    } catch {
      outcome = 'uncertain';
    }
    check(
      (
        await db
          .from('reminder_history')
          .upsert(
            {
              reminder_id: reminder.id,
              user_id: reminder.user_id,
              provider_message_id: messageId,
              outcome,
            },
            { onConflict: 'reminder_id' },
          )
      ).error,
    );
    check(
      (
        await db
          .from('reminders')
          .update({ state: outcome })
          .eq('id', reminder.id)
          .eq('claim_token', reminder.claim_token)
      ).error,
    );
  }
  return { submitted };
}
