-- Phase A, U2–U3. Pending uploads never count as submitted work.
begin;
alter table public.grade_items
  add column kind text not null default 'none' check(kind in ('file','link','none')),
  add column mode text not null default 'individual' check(mode in ('individual','group')),
  add column group_set_id uuid, add column due_at timestamptz,
  add foreign key(term_id,group_set_id) references public.group_sets(term_id,id),
  add check(mode='group' or group_set_id is null);
update public.grade_items set kind=case when code='FP' then 'link' when code in ('M1','M2','M3','M4','M5','O1','O2','O3') then 'file' else 'none' end,
  mode=case when code in ('M2','M3','M5','FP') then 'group' else 'individual' end;

create table public.submissions (
  id uuid not null default gen_random_uuid(), term_id text not null references public.terms(id),
  item_id integer not null, owner_uni text, group_id uuid,
  storage_path text, on_time_path text, on_time_started_at timestamptz, on_time_submitted_at timestamptz,
  link text, on_time_link text, file_name text, file_size bigint,
  started_at timestamptz not null, submitted_at timestamptz not null default clock_timestamp(),
  late boolean not null, submitted_by text not null, member_unis text[] not null,
  graded_at timestamptz,
  primary key(term_id,id),
  foreign key(term_id,item_id) references public.grade_items(term_id,id),
  foreign key(term_id,group_id) references public.class_groups(term_id,id),
  check((owner_uni is null) <> (group_id is null)),
  check((storage_path is null) <> (link is null)),
  check(file_size is null or file_size between 1 and 26214400)
);
create unique index one_individual_submission on public.submissions(term_id,item_id,owner_uni) where owner_uni is not null;
create unique index one_group_submission on public.submissions(term_id,item_id,group_id) where group_id is not null;
create table public.pending_uploads (
  id uuid not null default gen_random_uuid(), term_id text not null references public.terms(id),
  item_id integer not null, owner_uni text, group_id uuid, uploader_id uuid not null references auth.users(id),
  storage_path text not null unique, file_name text not null, file_size bigint not null check(file_size between 1 and 26214400),
  mime_type text not null, started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
  -- This column is never granted to browser callers. Only the file service can supply it.
  verification_receipt uuid,
  primary key(term_id,id), foreign key(term_id,item_id) references public.grade_items(term_id,id),
  foreign key(term_id,group_id) references public.class_groups(term_id,id),
  check((owner_uni is null) <> (group_id is null))
);
create unique index one_individual_pending on public.pending_uploads(term_id,item_id,owner_uni) where owner_uni is not null;
create unique index one_group_pending on public.pending_uploads(term_id,item_id,group_id) where group_id is not null;

do $$ declare t text; begin
  foreach t in array array['submissions','pending_uploads'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('create trigger preview_guard before insert or update or delete on public.%I for each row execute function private.block_preview_write()',t);
    execute format('create trigger change_audit after insert or update or delete on public.%I for each row execute function private.audit_class_change()',t);
  end loop;
end $$;
-- Pending audit records must not disclose the service receipt, even to staff.
create or replace function private.audit_class_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_log(actor_id,actor_email,table_name,operation,old_row,new_row)
  values(auth.uid(),private.current_email(),tg_table_name,tg_op,
    case when tg_op='INSERT' then null else to_jsonb(old)-'verification_receipt' end,
    case when tg_op='DELETE' then null else to_jsonb(new)-'verification_receipt' end);
  return null;
end $$;
grant select(id,term_id,item_id,owner_uni,group_id,storage_path,on_time_path,on_time_started_at,on_time_submitted_at,link,on_time_link,file_name,file_size,started_at,submitted_at,late,graded_at) on public.submissions to authenticated;
grant select(id,term_id,item_id,owner_uni,group_id,uploader_id,storage_path,file_name,file_size,mime_type,started_at,expires_at) on public.pending_uploads to authenticated;

create function private.submission_owner_read(t text,u text,g uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.can_read_term(t) and (private.current_role() in ('instructor','grader') or
    (private.current_role()='student' and (u=private.current_uni() or exists(select 1 from public.group_memberships m where m.term_id=t and m.group_id=g and m.uni=private.current_uni()))))
$$;
create policy submissions_read on public.submissions for select to authenticated using(private.submission_owner_read(term_id,owner_uni,group_id));
create policy pending_read on public.pending_uploads for select to authenticated using(private.current_role()='student' and uploader_id=auth.uid() and private.submission_owner_read(term_id,owner_uni,group_id));

create function private.submission_lock(t text,i integer,u text,g uuid) returns void
language sql security definer set search_path='' as $$
  select pg_advisory_xact_lock(hashtextextended('submission:'||t||':'||i||':'||coalesce(u,g::text),0))
$$;
-- All submission entry points derive ownership from the caller, never a browser UNI/group.
create function private.submission_target(p_item integer,p_kind text)
returns table(term_id text,owner_uni text,group_id uuid)
language plpgsql security definer set search_path='' as $$
declare i public.grade_items; t text:=private.active_term(); u text:=private.current_uni(); g uuid;
begin
  perform private.assert_writable();
  if private.current_role()<>'student' then raise exception 'Student access required.'; end if;
  if t is null or not private.can_read_term(t) then raise exception 'Active term access required.'; end if;
  select * into i from public.grade_items where id=p_item and grade_items.term_id=t for share;
  if not found or i.kind<>p_kind then raise exception 'This item does not accept this submission type.'; end if;
  if i.mode='group' then
    -- Serialize membership changes and uploads on the linked set before the owner lock.
    perform 1 from public.group_sets s where s.term_id=t and s.id=i.group_set_id for update;
    select m.group_id into g from public.group_memberships m where m.term_id=t and m.set_id=i.group_set_id and m.uni=u;
    if g is null then raise exception using errcode='P0002',message='Join a group first.'; end if;
  end if;
  perform private.submission_lock(t,p_item,case when g is null then u end,g);
  if exists(select 1 from public.submissions s where s.term_id=t and s.item_id=p_item
    and (s.owner_uni=u and g is null or s.group_id=g) and s.graded_at is not null) then raise exception 'Graded, locked.'; end if;
  return query select t,case when g is null then u end,g;
end $$;
create function public.begin_submission(p_item integer,p_name text,p_size bigint,p_type text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o record; p public.pending_uploads; ext text; allowed_type text;
begin
  perform private.assert_writable();
  select * into o from private.submission_target(p_item,'file');
  ext:=lower(substring(p_name from '[.]([^.]+)$'));
  allowed_type:=case ext when 'pdf' then 'application/pdf' when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    when 'zip' then 'application/zip' end;
  if p_name is null or length(p_name) not between 1 and 240 or p_name ~ '[/\\]' or allowed_type is null or p_type is distinct from allowed_type
    or p_size is null or p_size not between 1 and 26214400 then raise exception 'Use PDF, DOCX, XLSX, PPTX, or ZIP up to 25 MB.'; end if;
  -- Old objects become sweep candidates. A pending row is never a completed submission.
  delete from public.pending_uploads where term_id=o.term_id and item_id=p_item
    and (owner_uni=o.owner_uni or group_id=o.group_id);
  insert into public.pending_uploads(term_id,item_id,owner_uni,group_id,uploader_id,storage_path,file_name,file_size,mime_type)
    values(o.term_id,p_item,o.owner_uni,o.group_id,auth.uid(),
      o.term_id||'/'||p_item||'/'||coalesce(o.owner_uni,o.group_id::text)||'/'||gen_random_uuid()||'.'||ext,p_name,p_size,p_type) returning * into p;
  return to_jsonb(p)-'verification_receipt';
end $$;
-- Service-only attestation; callers cannot forge a validated finish through the public RPC.
create function public.confirm_submission_upload(p_pending uuid,p_size bigint,p_type text) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.pending_uploads; receipt uuid:=gen_random_uuid();
begin
  perform private.assert_writable();
  select * into p from public.pending_uploads where id=p_pending;
  if not found then raise exception 'Pending upload not found.'; end if;
  perform private.submission_lock(p.term_id,p.item_id,p.owner_uni,p.group_id);
  update public.pending_uploads set verification_receipt=receipt where id=p_pending and term_id=private.active_term()
    and expires_at>clock_timestamp() and file_size=p_size and mime_type=p_type;
  if not found then raise exception 'Pending upload expired or file metadata does not match.'; end if;
  return receipt;
end $$;
-- Shared final write also handles links. The caller holds the owner lock and set row lock.
create function private.store_submission(t text,i integer,u text,g uuid,p_path text,p_link text,p_name text,p_size bigint,p_started timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old public.submissions; saved public.submissions; due timestamptz; is_late boolean; members text[];
  keep_path text; keep_link text; keep_started timestamptz; keep_submitted timestamptz; removed text[];
begin
  perform private.assert_writable();
  select due_at into due from public.grade_items where term_id=t and id=i;
  is_late:=due is not null and p_started>due;
  select * into old from public.submissions where term_id=t and item_id=i and (owner_uni=u or group_id=g) for update;
  if old.graded_at is not null then raise exception 'Graded, locked.'; end if;
  if clock_timestamp()>due then
    if old.late=false then keep_path:=old.storage_path; keep_link:=old.link; keep_started:=old.started_at; keep_submitted:=old.submitted_at;
    else keep_path:=old.on_time_path; keep_link:=old.on_time_link; keep_started:=old.on_time_started_at; keep_submitted:=old.on_time_submitted_at; end if;
  end if;
  if g is null then members:=array[u];
  else select array_agg(m.uni order by m.uni) into members from public.group_memberships m join private.term_roster(t) r on r.uni=m.uni where m.term_id=t and m.group_id=g; end if;
  -- A timely upload that finishes late is still the latest on-time version.
  if not is_late then keep_path:=null; keep_link:=null; keep_started:=null; keep_submitted:=null; end if;
  if old.id is null then
    insert into public.submissions(term_id,item_id,owner_uni,group_id,storage_path,link,file_name,file_size,started_at,late,submitted_by,member_unis)
      values(t,i,u,g,p_path,p_link,p_name,p_size,p_started,is_late,private.current_uni(),members) returning * into saved;
  else
    update public.submissions set storage_path=p_path,link=p_link,file_name=p_name,file_size=p_size,
      started_at=p_started,submitted_at=clock_timestamp(),late=is_late,submitted_by=private.current_uni(),member_unis=members,
      on_time_path=keep_path,on_time_link=keep_link,on_time_started_at=keep_started,on_time_submitted_at=keep_submitted
      where term_id=t and id=old.id returning * into saved;
  end if;
  select coalesce(array_agg(distinct path),'{}') into removed from unnest(array[old.storage_path,old.on_time_path]) path
    where path is not null and path is distinct from saved.storage_path and path is distinct from saved.on_time_path;
  return jsonb_build_object('submission',to_jsonb(saved)-'member_unis'-'submitted_by','replaced_paths',to_jsonb(removed));
end $$;
create function public.finish_submission(p_pending uuid,p_receipt uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.pending_uploads; o record; result jsonb;
begin
  perform private.assert_writable();
  if private.current_role()<>'student' then raise exception 'Student access required.'; end if;
  select * into p from public.pending_uploads where id=p_pending and uploader_id=auth.uid();
  if not found then raise exception 'Pending upload not found.'; end if;
  select * into o from private.submission_target(p.item_id,'file');
  -- Re-read after waiting for the same owner lock used by grading and replacement.
  select * into p from public.pending_uploads where id=p_pending and uploader_id=auth.uid() for update;
  if not found or p.expires_at<=clock_timestamp() then raise exception 'Pending upload expired or superseded.'; end if;
  if p.owner_uni is distinct from o.owner_uni or p.group_id is distinct from o.group_id then raise exception 'Group membership changed. Start again.'; end if;
  if p_receipt is null or p.verification_receipt is distinct from p_receipt then raise exception 'Upload must be verified by the file service.'; end if;
  result:=private.store_submission(p.term_id,p.item_id,p.owner_uni,p.group_id,p.storage_path,null,p.file_name,p.file_size,p.started_at);
  delete from public.pending_uploads where term_id=p.term_id and id=p.id;
  return result;
end $$;
create function public.submit_link(p_item integer,p_link text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o record;
begin
  perform private.assert_writable(); select * into o from private.submission_target(p_item,'link');
  if p_link is null or length(p_link)>2000 or p_link !~ '^https://[^/[:space:]?#]+[^[:space:]]*$' then raise exception 'Use a valid https:// video link.'; end if;
  return private.store_submission(o.term_id,p_item,o.owner_uni,o.group_id,null,p_link,null,null,clock_timestamp());
end $$;

-- Only instructors can configure items. Changing ownership rules after submission is forbidden.
create function public.configure_grade_item(p_item integer,p_kind text,p_mode text,p_group_set uuid,p_due timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare i public.grade_items; t text:=private.active_term();
begin
  perform private.assert_writable(); perform private.require_instructor();
  select * into i from public.grade_items where term_id=t and id=p_item for update;
  if not found then raise exception 'Invalid item.'; end if;
  if exists(select 1 from public.submissions where term_id=t and item_id=p_item) and
    (i.kind is distinct from p_kind or i.mode is distinct from p_mode or i.group_set_id is distinct from p_group_set) then
    raise exception 'Submission mode cannot change after work has been submitted.'; end if;
  update public.grade_items set kind=p_kind,mode=p_mode,group_set_id=p_group_set,due_at=p_due where term_id=t and id=p_item;
end $$;
create trigger item_settings_audit after update on public.grade_items for each row execute function private.audit_class_change();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('submissions','submissions',false,26214400,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/zip']);
create function private.pending_path_writable(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_role()='student' and private.preview_uni() is null and exists(
    select 1 from public.pending_uploads p where p.storage_path=p_path and p.term_id=private.active_term()
      and p.uploader_id=auth.uid() and p.expires_at>now() and private.submission_owner_read(p.term_id,p.owner_uni,p.group_id))
$$;
create policy submission_object_insert on storage.objects for insert to authenticated with check(bucket_id='submissions' and private.pending_path_writable(name));
create policy submission_object_no_direct_read on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'submissions');
-- A sweep finds superseded objects even when begin replaced their pending row.
create function public.submission_sweep_candidates(p_limit integer default 100) returns text[]
language plpgsql security definer set search_path='' as $$
declare x record; result text[]:='{}';
begin
  perform private.assert_writable();
  for x in select o.name from storage.objects o where o.bucket_id='submissions'
    and not exists(select 1 from public.submissions s where o.name in (s.storage_path,s.on_time_path))
    and not exists(select 1 from public.pending_uploads p where p.storage_path=o.name and p.expires_at>clock_timestamp())
    order by o.name limit least(greatest(p_limit,1),500) loop
    if x.name !~ '^[a-z0-9-]+/[0-9]+/([a-z]{1,8}[0-9]{1,8}|[0-9a-f-]{36})/[0-9a-f-]{36}[.](pdf|docx|xlsx|pptx|zip)$' then continue; end if;
    perform pg_advisory_xact_lock(hashtextextended('submission:'||split_part(x.name,'/',1)||':'||split_part(x.name,'/',2)||':'||split_part(x.name,'/',3),0));
    if exists(select 1 from public.submissions s where x.name in (s.storage_path,s.on_time_path)) or
      exists(select 1 from public.pending_uploads p where p.storage_path=x.name and p.expires_at>clock_timestamp()) then continue; end if;
    delete from public.pending_uploads where storage_path=x.name;
    result:=array_append(result,x.name);
  end loop;
  return result;
end $$;

revoke all on function private.submission_owner_read(text,text,uuid),private.submission_lock(text,integer,text,uuid),private.submission_target(integer,text),private.store_submission(text,integer,text,uuid,text,text,text,bigint,timestamptz),private.pending_path_writable(text) from public,anon,authenticated;
grant execute on function private.submission_owner_read(text,text,uuid),private.pending_path_writable(text) to authenticated;
revoke all on function public.begin_submission(integer,text,bigint,text),public.finish_submission(uuid,uuid),public.submit_link(integer,text),public.configure_grade_item(integer,text,text,uuid,timestamptz) from public,anon;
grant execute on function public.begin_submission(integer,text,bigint,text),public.finish_submission(uuid,uuid),public.submit_link(integer,text),public.configure_grade_item(integer,text,text,uuid,timestamptz) to authenticated;
revoke all on function public.confirm_submission_upload(uuid,bigint,text),public.submission_sweep_candidates(integer) from public,anon,authenticated;
grant execute on function public.confirm_submission_upload(uuid,bigint,text),public.submission_sweep_candidates(integer) to service_role;
create or replace function public.choose_group(p_set uuid,p_group uuid default null,p_uni text default null) returns void
language plpgsql security definer set search_path='' as $$
declare s public.group_sets; u text; r text:=private.current_role(); t text:=private.active_term();
begin
  perform private.assert_writable();
  if r not in ('student','instructor') then raise exception 'Class access required.'; end if;
  u:=case when r='instructor' then p_uni else private.current_uni() end;
  if r='student' and p_uni is not null and p_uni is distinct from u then raise exception 'You can only change your own group.'; end if;
  if u is null or not exists(select 1 from private.term_roster(t) where uni=u) then raise exception 'Student not found.'; end if;
  select * into s from public.group_sets where term_id=t and id=p_set for update;
  if not found then raise exception 'Group set not found.'; end if;
  if r='student' and (not s.is_open or (s.deadline is not null and clock_timestamp()>=s.deadline) or exists(select 1 from public.grade_items i where i.term_id=t and i.group_set_id=p_set and i.mode='group' and i.due_at<=clock_timestamp())) then raise exception 'Sign-up is closed.'; end if;
  if p_group is null then delete from public.group_memberships where term_id=t and set_id=p_set and uni=u; return; end if;
  if not exists(select 1 from public.class_groups where term_id=t and id=p_group and set_id=p_set) then raise exception 'Group not found in this set.'; end if;
  if exists(select 1 from public.group_memberships where term_id=t and set_id=p_set and uni=u and group_id=p_group) then return; end if;
  if (select count(*) from public.group_memberships m join private.term_roster(t) r on r.uni=m.uni where m.term_id=t and m.group_id=p_group)>=s.max_size then raise exception 'This group is full.'; end if;
  insert into public.group_memberships(term_id,set_id,group_id,uni) values(t,p_set,p_group,u)
    on conflict(term_id,set_id,uni) do update set group_id=excluded.group_id;
end $$;
-- Failure cleanup is also conditional on committed references. A duplicate finish must
-- never delete the file committed by the first request.
create function public.reject_submission_upload(p_pending uuid) returns text[]
language plpgsql security definer set search_path='' as $$
declare p public.pending_uploads;
begin
  perform private.assert_writable();
  select * into p from public.pending_uploads where id=p_pending;
  if not found then return '{}'; end if;
  perform private.submission_lock(p.term_id,p.item_id,p.owner_uni,p.group_id);
  select * into p from public.pending_uploads where id=p_pending for update;
  if not found then return '{}'; end if;
  delete from public.pending_uploads where id=p_pending;
  if exists(select 1 from public.submissions s where p.storage_path in (s.storage_path,s.on_time_path)) then return '{}'; end if;
  return array[p.storage_path];
end $$;
revoke all on function public.reject_submission_upload(uuid) from public,anon,authenticated;
grant execute on function public.reject_submission_upload(uuid) to service_role;

create or replace function private.term_snapshot(t text,u text,r text) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object(
  'term_id',t,
  'sessions',(select coalesce(jsonb_agg(s order by week),'[]') from public.attendance_sessions s where s.term_id=t),
  'attendance',(select coalesce(jsonb_agg(jsonb_build_object('uni',a.uni,'week',a.week,'status',a.status,
    'source_quiz',case when r in ('instructor','grader') or i.released then a.source_quiz else null end,
    'manual_override',case when r in ('instructor','grader') or i.released then a.manual_override else null end) order by a.week),'[]')
    from public.attendance a left join public.grade_items i on i.term_id=a.term_id and i.quiz_week=a.source_quiz
    where a.term_id=t and (r in ('instructor','grader') or (r='student' and a.uni=u))),
  'items',(select coalesce(jsonb_agg(i order by id),'[]') from public.grade_items i where i.term_id=t and (r in ('instructor','grader') or (r='student' and i.released))),
  'grades',(select coalesce(jsonb_agg(g),'[]') from public.grades g join public.grade_items i on i.term_id=g.term_id and i.id=g.item_id
    where g.term_id=t and (r in ('instructor','grader') or (r='student' and g.uni=u and i.released))),
  'sets',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('submission_deadline',(select min(i.due_at) from public.grade_items i where i.term_id=t and i.group_set_id=s.id and i.mode='group')) order by created_at),'[]') from public.group_sets s where s.term_id=t and r in ('instructor','grader','student')),
  'groups',(select coalesce(jsonb_agg(g order by number),'[]') from public.class_groups g where g.term_id=t and r in ('instructor','grader','student')),
  'members',(select coalesce(jsonb_agg(jsonb_build_object('set_id',m.set_id,'group_id',m.group_id,
    'uni',case when r in ('instructor','grader') or m.uni=u then m.uni else null end,
    'name',case when r in ('instructor','grader') or exists(select 1 from public.group_memberships mine where mine.term_id=t and mine.uni=u and mine.group_id=m.group_id) then coalesce(nullif(c.name,''),'Student') else null end,
    'email',case when r='instructor' or (r='student' and exists(select 1 from public.group_memberships mine where mine.term_id=t and mine.uni=u and mine.group_id=m.group_id)) then c.email else null end)),'[]')
    from public.group_memberships m join private.term_roster(t) c on c.uni=m.uni where m.term_id=t and r in ('instructor','grader','student')),
  'assignments',(select coalesce(jsonb_agg(a order by id),'[]') from public.assignments a where a.term_id=t and (r in ('instructor','grader','student') or (r='auditor' and a.auditor_visible))),
  'files',(select coalesce(jsonb_agg(f order by created_at),'[]') from public.lecture_files f where f.term_id=t and
    (r in ('instructor','grader') or ((r='student' or (r='auditor' and f.auditor_visible)) and (f.released or f.release_at<=now())))),
  'announcements',(select coalesce(jsonb_agg(a order by created_at desc,id),'[]') from public.announcements a where a.term_id=t and r in ('instructor','grader','student','auditor'))
) || case when r in ('instructor','grader') then jsonb_build_object('roster',
  (select coalesce(jsonb_agg(case when r='grader' then jsonb_build_object('uni',c.uni,'name',c.name) else to_jsonb(c) end order by c.uni),'[]') from private.term_roster(t) c)) else '{}'::jsonb end
$$;
commit;
