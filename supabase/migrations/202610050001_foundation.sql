-- Backend writes go through authenticated routes and service-only functions.
-- Browsers get read-only ownership policies; no client may forge verification/current flags.
create extension if not exists pgcrypto;
create type public.document_type as enum ('PASSPORT','VISA','I20','I94','CPT','EAD','UNKNOWN');
create table public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check(length(display_name)<=100),
 immigration_category text not null default 'F1' check(immigration_category='F1'),
 timezone text not null default 'America/Chicago',
 deleting_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_preferences (
 user_id uuid primary key references public.profiles(user_id) on delete cascade,
 reminder_offsets integer[] not null default array[180,90,60,30,14,7,1],
 whatsapp_reminders boolean not null default false,
 updated_at timestamptz not null default now(),
 check(reminder_offsets <@ array[180,90,60,30,14,7,1])
);
create table public.documents (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(user_id) on delete cascade,
 storage_path text not null unique,mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
 byte_size integer not null check(byte_size>0 and byte_size<=4194304),
 document_type public.document_type not null default 'UNKNOWN',
 status text not null default 'queued' check(status in ('queued','extracting_text','identifying_document','extracting_information','needs_review','complete','failed')),
 issue_date date,is_current boolean not null default false,current_source text not null default 'auto' check(current_source in ('auto','manual')),
 confidence jsonb not null default '{}',reviewed_at timestamptz,deleted_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,user_id)
);
create unique index one_current_document on public.documents(user_id,document_type) where is_current and deleted_at is null;
create index documents_owner on public.documents(user_id,created_at desc);
-- A documents row is an immutable uploaded version. Versions are grouped by owner/type.
create view public.document_versions with (security_invoker=true) as
 select id,user_id,document_type,issue_date,is_current,current_source,created_at from public.documents where deleted_at is null;
create table public.document_extractions (
 document_id uuid primary key,user_id uuid not null,raw_extraction jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(document_id,user_id) references public.documents(id,user_id) on delete cascade
);
create table public.passports (
 document_id uuid primary key,user_id uuid not null,full_name text,passport_number text,nationality text,date_of_birth date,issue_date date,expiration_date date,
 foreign key(document_id,user_id) references public.documents(id,user_id) on delete cascade
);
create table public.visas (
 document_id uuid primary key,user_id uuid not null,full_name text,visa_type text,visa_number text,issue_date date,expiration_date date,issuing_location text,
 foreign key(document_id,user_id) references public.documents(id,user_id) on delete cascade
);
create table public.i20_records (
 document_id uuid primary key,user_id uuid not null,full_name text,sevis_id text,school text,program text,education_level text,
 program_start date,program_end date,issue_date date,travel_signature_date date,cpt_authorized boolean,employer text,employment_start date,employment_end date,
 foreign key(document_id,user_id) references public.documents(id,user_id) on delete cascade
);
create table public.i94_records (
 document_id uuid primary key,user_id uuid not null,full_name text,admission_number text,class_of_admission text,admit_until text,entry_date date,
 check(admit_until is null or admit_until='D/S' or admit_until ~ '^\d{4}-\d{2}-\d{2}$'),
 foreign key(document_id,user_id) references public.documents(id,user_id) on delete cascade
);
create table public.ead_records (
 document_id uuid primary key,user_id uuid not null,full_name text,category text,card_number text,valid_from date,expiration_date date,issue_date date,
 foreign key(document_id,user_id) references public.documents(id,user_id) on delete cascade
);
create table public.cpt_authorizations (
 document_id uuid primary key,user_id uuid not null,full_name text,issue_date date,cpt_authorized boolean,employer text,employment_start date,employment_end date,
 foreign key(document_id,user_id) references public.documents(id,user_id) on delete cascade
);
create table public.reminders (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,document_id uuid not null,
 field_name text not null,label text not null,deadline date not null,offset_days integer not null,scheduled_date date not null,
 state text not null default 'pending' check(state in ('pending','sending','submitted','failed','uncertain','cancelled')),
 claim_token uuid,claimed_at timestamptz,created_at timestamptz not null default now(),
 foreign key(document_id,user_id) references public.documents(id,user_id) on delete cascade,
 unique(document_id,field_name,deadline,offset_days),check(offset_days in (180,90,60,30,14,7,1))
);
create table public.reminder_history (
 id uuid primary key default gen_random_uuid(),reminder_id uuid not null references public.reminders(id) on delete cascade,
 user_id uuid not null references public.profiles(user_id) on delete cascade,
 provider_message_id text,outcome text not null check(outcome in ('submitted','failed','uncertain')),
 created_at timestamptz not null default now(),unique(reminder_id)
);
create table public.whatsapp_accounts (
 user_id uuid primary key references public.profiles(user_id) on delete cascade,
 phone text not null unique check(phone ~ '^\+[1-9][0-9]{7,14}$'),verified_at timestamptz not null,
 consent_at timestamptz not null,last_inbound_at timestamptz,created_at timestamptz not null default now()
);
create table public.whatsapp_link_challenges (
 user_id uuid primary key references public.profiles(user_id) on delete cascade,
 phone text not null,token_hash text not null unique,expires_at timestamptz not null,consent_at timestamptz not null
);
create table public.whatsapp_messages (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(user_id) on delete cascade,
 provider_message_id text not null unique,intent text,created_at timestamptz not null default now()
);
create table public.ai_conversations (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(user_id) on delete cascade,
 channel text not null check(channel in ('web','whatsapp')),intent text not null,created_at timestamptz not null default now()
);
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(user_id) on delete cascade,
 document_id uuid references public.documents(id) on delete set null,action text not null,created_at timestamptz not null default now()
);
create table public.jobs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(user_id) on delete cascade,
 document_id uuid,kind text not null check(kind in ('extract','whatsapp','delete_document','delete_account')),
 payload jsonb not null default '{}',dedupe_key text not null unique,
 state text not null default 'pending' check(state in ('pending','running','done','failed','uncertain')),
 attempts integer not null default 0,claim_token uuid,claimed_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.rate_limits (key text primary key,window_start timestamptz not null,count integer not null);

create function public.init_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into profiles(user_id) values(new.id);
 insert into user_preferences(user_id) values(new.id);
 return new;
end $$;
create trigger auth_user_created after insert on auth.users for each row execute function public.init_profile();

-- Every PII table is RLS protected. No INSERT/UPDATE/DELETE grants for anon/authenticated.
do $$ declare t text; begin
 foreach t in array array['profiles','user_preferences','documents','document_extractions','passports','visas','i20_records','i94_records','ead_records','cpt_authorizations','reminders','reminder_history','whatsapp_accounts','whatsapp_link_challenges','whatsapp_messages','ai_conversations','audit_logs','jobs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  if t not in ('jobs','whatsapp_link_challenges','document_extractions') then
   execute format('grant select on public.%I to authenticated',t);
   execute format('create policy own_rows on public.%I for select to authenticated using (auth.uid() = user_id)',t);
  end if;
 end loop;
end $$;
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon,authenticated;
grant select on public.document_versions to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('immigration-documents','immigration-documents',false,4194304,array['application/pdf','image/png','image/jpeg']);
-- No direct storage policy. Server validates magic bytes, ownership and issues 60s signed URLs.

create function public.consume_rate_limit(p_key text,p_max integer,p_seconds integer) returns boolean
language plpgsql security definer set search_path=public as $$
declare n integer; begin
 insert into rate_limits(key,window_start,count) values(p_key,now(),1)
 on conflict(key) do update set
 count=case when rate_limits.window_start < now()-make_interval(secs=>p_seconds) then 1 else rate_limits.count+1 end,
 window_start=case when rate_limits.window_start < now()-make_interval(secs=>p_seconds) then now() else rate_limits.window_start end
 returning count into n;
 return n<=p_max;
end $$;

create function public.recompute_current(p_user uuid,p_type public.document_type) returns void
language plpgsql security definer set search_path=public as $$
declare chosen uuid; top_date date; n integer; begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_type::text,0));
 if exists(select 1 from documents where user_id=p_user and document_type=p_type and is_current and current_source='manual' and deleted_at is null) then return;end if;
 select max(issue_date) into top_date from documents where user_id=p_user and document_type=p_type and deleted_at is null and status in ('complete','needs_review');
 select count(*) into n from documents where user_id=p_user and document_type=p_type and deleted_at is null and issue_date=top_date and status in ('complete','needs_review');
 if n=1 then select id into chosen from documents where user_id=p_user and document_type=p_type and deleted_at is null and issue_date=top_date and status in ('complete','needs_review');end if;
 update documents set is_current=false where user_id=p_user and document_type=p_type;
 if chosen is not null then update documents set is_current=true,current_source='auto' where id=chosen;end if;
 update reminders r set state='cancelled' where r.user_id=p_user and r.state='pending' and exists(select 1 from documents d where d.id=r.document_id and d.document_type=p_type and not d.is_current);
end $$;

create function public.save_document_fields(p_user uuid,p_document uuid,p_type public.document_type,p_fields jsonb,p_confidence jsonb,p_raw jsonb,p_review boolean) returns void
language plpgsql security definer set search_path=public as $$
declare target text; old_type public.document_type; begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1));
 select document_type into old_type from documents where id=p_document and user_id=p_user and deleted_at is null for update;
 if not found then raise exception 'document unavailable';end if;
 if exists(select 1 from profiles where user_id=p_user and deleting_at is not null)then raise exception 'account unavailable';end if;
 foreach target in array array['passports','visas','i20_records','i94_records','ead_records','cpt_authorizations'] loop
  execute format('delete from public.%I where document_id=$1 and user_id=$2',target) using p_document,p_user;
 end loop;
 target=case p_type when 'PASSPORT' then 'passports' when 'VISA' then 'visas' when 'I20' then 'i20_records' when 'I94' then 'i94_records' when 'EAD' then 'ead_records' when 'CPT' then 'cpt_authorizations' else null end;
 if target is not null then
  execute format('insert into public.%1$I select * from jsonb_populate_record(null::public.%1$I,$1)',target)
  using p_fields || jsonb_build_object('document_id',p_document,'user_id',p_user);
 end if;
 update documents set document_type=p_type,issue_date=nullif(p_fields->>'issue_date','')::date,
 status=case when p_review then 'complete' else 'needs_review' end,reviewed_at=case when p_review then now() else null end,
 confidence=p_confidence,is_current=case when old_type=p_type then is_current else false end,updated_at=now()
 where id=p_document and user_id=p_user;
 -- Delete raw evidence on manual review: no stale sensitive extraction data after corrections.
 delete from document_extractions where document_id=p_document;
 if not p_review then insert into document_extractions(document_id,user_id,raw_extraction)values(p_document,p_user,p_raw);end if;
 update reminders set state='cancelled' where document_id=p_document and state='pending';
 perform recompute_current(p_user,old_type);perform recompute_current(p_user,p_type);
end $$;

create function public.select_current(p_user uuid,p_document uuid) returns void
language plpgsql security definer set search_path=public as $$
declare dtype public.document_type;begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1));
 select document_type into dtype from documents where id=p_document and user_id=p_user and deleted_at is null and document_type<>'UNKNOWN' and status in ('complete','needs_review') for update;
 if not found then raise exception 'document unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||dtype::text,0));
 update documents set is_current=false,current_source='auto' where user_id=p_user and document_type=dtype;
 update documents set is_current=true,current_source='manual' where id=p_document and user_id=p_user;
 update reminders r set state='cancelled' where user_id=p_user and state='pending' and document_id<>p_document and exists(select 1 from documents d where d.id=r.document_id and d.document_type=dtype);
end $$;

create function public.claim_jobs(p_limit integer) returns setof public.jobs language plpgsql security definer set search_path=public as $$
begin
 -- External sends are not automatically retried after ambiguous failure: prefer review over duplicates.
 update jobs set state=case when kind='whatsapp' then 'uncertain' else 'pending' end where state='running' and claimed_at<now()-interval '10 minutes';
 return query with candidates as (select id from jobs where state='pending' and attempts<3 order by created_at for update skip locked limit p_limit)
 update jobs j set state='running',attempts=j.attempts+1,claimed_at=now(),claim_token=gen_random_uuid() from candidates c where j.id=c.id returning j.*;
end $$;
create function public.claim_reminders(p_limit integer) returns setof public.reminders language plpgsql security definer set search_path=public as $$
begin
 update reminders set state='uncertain' where state='sending' and claimed_at<now()-interval '10 minutes';
 return query with candidates as (
 select r.id from reminders r join profiles p on p.user_id=r.user_id join documents d on d.id=r.document_id
 join user_preferences u on u.user_id=r.user_id join whatsapp_accounts w on w.user_id=r.user_id
 where r.state='pending' and d.deleted_at is null and d.is_current and d.reviewed_at is not null and p.deleting_at is null
 and u.whatsapp_reminders and r.offset_days=any(u.reminder_offsets)
 and r.scheduled_date=(now() at time zone p.timezone)::date and r.deadline>=(now() at time zone p.timezone)::date
 order by r.scheduled_date for update of r skip locked limit p_limit)
 update reminders r set state='sending',claimed_at=now(),claim_token=gen_random_uuid() from candidates c where r.id=c.id returning r.*;
end $$;
create function public.verify_whatsapp(p_hash text,p_phone text) returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid;consent timestamptz;begin
 select user_id,consent_at into u,consent from whatsapp_link_challenges where token_hash=p_hash and phone=p_phone and expires_at>now() for update;
 if not found then return null;end if;
 if exists(select 1 from profiles where user_id=u and deleting_at is not null)then return null;end if;
 if exists(select 1 from whatsapp_accounts where phone=p_phone and user_id<>u)then return null;end if;
 insert into whatsapp_accounts(user_id,phone,verified_at,consent_at,last_inbound_at)values(u,p_phone,now(),consent,now())
 on conflict(user_id) do update set phone=excluded.phone,verified_at=now(),consent_at=excluded.consent_at,last_inbound_at=now();
 delete from whatsapp_link_challenges where user_id=u;return u;
end $$;
-- Functions are service-only. PostgreSQL grants EXECUTE to PUBLIC by default: explicitly revoke it.
do $$ declare fn record;begin
 for fn in select p.oid::regprocedure as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('consume_rate_limit','recompute_current','save_document_fields','select_current','claim_jobs','claim_reminders','verify_whatsapp','init_profile') loop
 execute format('revoke all on function %s from public,anon,authenticated',fn.name);
 execute format('grant execute on function %s to service_role',fn.name);
 end loop;
end $$;
