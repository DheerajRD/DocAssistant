create function public.clear_document_extraction(p_user uuid,p_document uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform save_document_fields(p_user,p_document,'UNKNOWN','{}','{}','{}',false);
 delete from document_extractions where document_id=p_document and user_id=p_user;
 delete from reminders where document_id=p_document and user_id=p_user;
 update jobs set payload='{}',state='done' where user_id=p_user and document_id=p_document and kind='extract';
end $$;
-- Preserve only the information the private deletion worker needs to remove pseudonymous
-- rate-limit keys, while removing WhatsApp access immediately.
create or replace function public.queue_account_deletion(p_user uuid) returns void
language plpgsql security definer set search_path=public as $$
declare linked_phone text;begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1));
 select phone into linked_phone from whatsapp_accounts where user_id=p_user;
 update profiles set deleting_at=now() where user_id=p_user;
 update documents set deleted_at=now(),is_current=false where user_id=p_user;
 update reminders set state='cancelled' where user_id=p_user and state='pending';
 delete from whatsapp_accounts where user_id=p_user;
 delete from whatsapp_link_challenges where user_id=p_user;
 update jobs set state='done',payload='{}' where user_id=p_user and kind in ('extract','whatsapp');
 insert into jobs(user_id,kind,dedupe_key,payload)values(p_user,'delete_account','delete_account:'||p_user,jsonb_strip_nulls(jsonb_build_object('phone',linked_phone)))
 on conflict(dedupe_key)do update set state='pending',attempts=0,payload=jobs.payload||excluded.payload;
end $$;
revoke all on function public.clear_document_extraction(uuid,uuid) from public,anon,authenticated;
grant execute on function public.clear_document_extraction(uuid,uuid) to service_role;
