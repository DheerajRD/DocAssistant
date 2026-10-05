-- Atomically register the version and extraction job after its private object is stored.
create function public.register_document(p_user uuid,p_id uuid,p_path text,p_mime text,p_size integer) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1));
 perform 1 from profiles where user_id=p_user and deleting_at is null for update;
 if not found then raise exception 'account unavailable';end if;
 if p_path<>p_user::text||'/'||p_id::text then raise exception 'storage ownership mismatch';end if;
 if (select count(*) from documents where user_id=p_user and deleted_at is null)>=100 then raise exception 'document limit';end if;
 insert into documents(id,user_id,storage_path,mime_type,byte_size)values(p_id,p_user,p_path,p_mime,p_size);
 insert into jobs(user_id,document_id,kind,dedupe_key)values(p_user,p_id,'extract','extract:'||p_id);
end $$;
create function public.queue_whatsapp_question(p_user uuid,p_phone text,p_message text,p_question text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from whatsapp_accounts w join profiles p on p.user_id=w.user_id where w.user_id=p_user and w.phone=p_phone and w.verified_at is not null and w.consent_at is not null and p.deleting_at is null)then return false;end if;
 insert into whatsapp_messages(user_id,provider_message_id)values(p_user,p_message) on conflict(provider_message_id)do nothing;
 if not found then return false;end if;
 insert into jobs(user_id,kind,dedupe_key,payload)values(p_user,'whatsapp','whatsapp:'||p_message,jsonb_build_object('question',p_question,'message_id',p_message));
 update whatsapp_accounts set last_inbound_at=now()where user_id=p_user and phone=p_phone;
 return true;
end $$;
revoke all on function public.register_document(uuid,uuid,text,text,integer) from public,anon,authenticated;
revoke all on function public.queue_whatsapp_question(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.register_document(uuid,uuid,text,text,integer) to service_role;
grant execute on function public.queue_whatsapp_question(uuid,text,text,text) to service_role;
