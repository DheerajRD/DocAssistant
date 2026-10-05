create function public.sync_reminder_plan(p_user uuid,p_plan jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare item jsonb;begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1));
 update reminders set state='cancelled' where user_id=p_user and state='pending';
 for item in select value from jsonb_array_elements(p_plan) loop
  if not exists(select 1 from documents where id=(item->>'document_id')::uuid and user_id=p_user and is_current and deleted_at is null and reviewed_at is not null)then continue;end if;
  insert into reminders(user_id,document_id,field_name,label,deadline,offset_days,scheduled_date)
   values(p_user,(item->>'document_id')::uuid,item->>'field_name',item->>'label',(item->>'deadline')::date,(item->>'offset_days')::integer,(item->>'scheduled_date')::date)
  on conflict(document_id,field_name,deadline,offset_days)do update set state=case when reminders.state='cancelled' then 'pending' else reminders.state end;
 end loop;
end $$;
revoke all on function public.sync_reminder_plan(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sync_reminder_plan(uuid,jsonb) to service_role;
