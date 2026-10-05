create function public.queue_document_deletion(p_user uuid,p_document uuid) returns void
language plpgsql security definer set search_path=public as $$
declare d documents;begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1));
 select * into d from documents where id=p_document and user_id=p_user for update;
 if not found then raise exception 'document unavailable';end if;
 update documents set deleted_at=now(),is_current=false where id=p_document and user_id=p_user;
 update reminders set state='cancelled' where document_id=p_document and user_id=p_user and state='pending';
 update jobs set state='done',payload='{}' where document_id=p_document and user_id=p_user and kind='extract';
 insert into jobs(user_id,document_id,kind,payload,dedupe_key)values(p_user,p_document,'delete_document',jsonb_build_object('storage_path',d.storage_path),'delete:'||p_document)
 on conflict(dedupe_key)do update set state='pending',attempts=0;
 perform recompute_current(p_user,d.document_type);
 insert into audit_logs(user_id,document_id,action)values(p_user,p_document,'document_deletion_requested');
end $$;
create function public.queue_account_deletion(p_user uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1));
 update profiles set deleting_at=now() where user_id=p_user;
 update documents set deleted_at=now(),is_current=false where user_id=p_user;
 update reminders set state='cancelled' where user_id=p_user and state='pending';
 delete from whatsapp_accounts where user_id=p_user;
 delete from whatsapp_link_challenges where user_id=p_user;
 update jobs set state='done',payload='{}' where user_id=p_user and kind in ('extract','whatsapp');
 insert into jobs(user_id,kind,dedupe_key)values(p_user,'delete_account','delete_account:'||p_user)
 on conflict(dedupe_key)do update set state='pending',attempts=0;
end $$;
revoke all on function public.queue_document_deletion(uuid,uuid) from public,anon,authenticated;
revoke all on function public.queue_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.queue_document_deletion(uuid,uuid) to service_role;
grant execute on function public.queue_account_deletion(uuid) to service_role;
