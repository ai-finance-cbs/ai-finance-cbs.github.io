-- Phase C: explicit export, close, and purge. No scheduled or automatic deletion.
begin;
create table public.term_exports (
  term_id text primary key references public.terms(id),
  exported_at timestamptz not null default clock_timestamp(),
  file_count integer not null check(file_count>=0), byte_count bigint not null check(byte_count>=0),
  closed_at timestamptz, purged_at timestamptz
);
alter table public.term_exports enable row level security;
revoke all on public.term_exports from public,anon,authenticated;
grant select(term_id,exported_at,file_count,byte_count,closed_at,purged_at) on public.term_exports to authenticated;
create policy instructor_exports on public.term_exports for select to authenticated using(private.current_role()='instructor');
create trigger preview_guard before insert or update or delete on public.term_exports for each row execute function private.block_preview_write();
create trigger change_audit after insert or update or delete on public.term_exports for each row execute function private.audit_class_change();

create function public.open_term(p_name text) returns text
language plpgsql security definer set search_path='' as $$
declare old_term text; new_term text:=trim(both '-' from regexp_replace(lower(btrim(p_name)),'[^a-z0-9]+','-','g'));
begin
  perform private.assert_writable(); perform private.require_instructor();
  perform pg_advisory_xact_lock(hashtextextended('course-term-rollover',0));
  if p_name is null or length(btrim(p_name)) not between 1 and 100 or length(new_term) not between 1 and 40 then raise exception 'Enter a short, distinct term name.'; end if;
  if exists(select 1 from public.terms where id=new_term) then raise exception 'This term already exists.'; end if;
  select id into old_term from public.terms where status='active' for update;
  if old_term is null then raise exception 'No active term to copy.'; end if;
  update public.terms set status='archived-readable' where id=old_term;
  insert into public.terms(id,title,status) values(new_term,btrim(p_name),'active');
  -- Composite term keys allow template group IDs to stay stable; no membership is copied.
  insert into public.group_sets(term_id,id,title,max_size,is_open,deadline)
    select new_term,id,title,max_size,false,null from public.group_sets where term_id=old_term;
  insert into public.class_groups(term_id,id,set_id,number)
    select new_term,id,set_id,number from public.class_groups where term_id=old_term;
  insert into public.grade_items(term_id,code,title,max_points,optional,quiz_week,released,kind,mode,group_set_id,due_at)
    select new_term,code,title,max_points,optional,quiz_week,false,kind,mode,group_set_id,null from public.grade_items where term_id=old_term order by id;
  insert into public.attendance_sessions(term_id,week,date,starts_at,ends_at)
    select new_term,week,null,null,null from public.attendance_sessions where term_id=old_term;
  insert into public.assignments(term_id,id,title,due,points,description,deliverable,grading,auditor_visible)
    select new_term,id,title,'TBA',points,description,deliverable,grading,auditor_visible from public.assignments where term_id=old_term;
  return new_term;
end $$;

create function public.staff_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.assert_writable(); perform private.require_instructor();
  return jsonb_build_object('terms',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('exported_at',e.exported_at,'purged_at',e.purged_at) order by t.created_at,t.id),'[]')
    from public.terms t left join public.term_exports e on e.term_id=t.id),
    'storage_bytes',(select coalesce(sum(coalesce((to_jsonb(o)->'metadata'->>'size')::bigint,0)),0) from storage.objects o),
    'storage_limit',1073741824);
end $$;

create function public.term_export_manifest(p_term text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.assert_writable(); perform private.require_instructor();
  if not exists(select 1 from public.terms where id=p_term and status='archived-readable') then raise exception 'Export an archived, readable term.'; end if;
  return private.term_snapshot(p_term,null,'instructor')||private.submission_snapshot(p_term,null,'instructor')||
    jsonb_build_object('term',(select to_jsonb(t) from public.terms t where id=p_term));
end $$;

-- Only the file function records a complete export. Browser callers cannot forge this gate.
create function public.record_term_export(p_term text,p_files integer,p_bytes bigint) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_writable();
  perform 1 from public.terms where id=p_term and status='archived-readable' for update;
  if not found then raise exception 'Term is not available for export.'; end if;
  insert into public.term_exports(term_id,file_count,byte_count) values(p_term,p_files,p_bytes)
    on conflict(term_id) do update set exported_at=clock_timestamp(),file_count=excluded.file_count,byte_count=excluded.byte_count;
end $$;

create function public.close_previous_term(p_term text default null) returns void
language plpgsql security definer set search_path='' as $$
declare t text:=p_term;
begin
  perform private.assert_writable(); perform private.require_instructor();
  perform pg_advisory_xact_lock(hashtextextended('course-term-rollover',0));
  if t is null then select id into t from public.terms where status='archived-readable' order by created_at desc,id desc limit 1; end if;
  perform 1 from public.terms where id=t and status='archived-readable' for update;
  if not found then raise exception 'Choose an archived, readable term.'; end if;
  if not exists(select 1 from public.term_exports where term_id=t) then raise exception 'Download the term export before closing access.'; end if;
  update public.terms set status='closed' where id=t;
  update public.term_exports set closed_at=clock_timestamp() where term_id=t;
end $$;

create function public.term_purge_manifest(p_term text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.assert_writable(); perform private.require_instructor();
  if not exists(select 1 from public.terms t join public.term_exports e on e.term_id=t.id where t.id=p_term and t.status='closed' and e.closed_at is not null) then raise exception 'Export and close the term before purging files.'; end if;
  -- Include orphaned pending uploads under the closed term's prefix, never a browser-supplied path.
  return jsonb_build_object('term_id',p_term,'objects',(select coalesce(jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'path',o.name)),'[]')
    from storage.objects o where (o.bucket_id='submissions' and starts_with(o.name,p_term||'/')) or
      (o.bucket_id='lecture-notes' and exists(select 1 from public.lecture_files f where f.term_id=p_term and f.storage_path=o.name))));
end $$;

create function public.record_term_purge(p_term text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_writable();
  perform 1 from public.terms t join public.term_exports e on e.term_id=t.id where t.id=p_term and t.status='closed' and e.closed_at is not null for update of t;
  if not found then raise exception 'Export and close the term before purging files.'; end if;
  if exists(select 1 from storage.objects o where (o.bucket_id='submissions' and starts_with(o.name,p_term||'/')) or
      (o.bucket_id='lecture-notes' and exists(select 1 from public.lecture_files f where f.term_id=p_term and f.storage_path=o.name))) then raise exception 'Stored files remain. Retry purge.'; end if;
  update public.term_exports set purged_at=clock_timestamp() where term_id=p_term and purged_at is null;
end $$;

revoke all on function public.open_term(text),public.staff_overview(),public.term_export_manifest(text),public.close_previous_term(text),public.term_purge_manifest(text) from public,anon,authenticated;
grant execute on function public.open_term(text),public.staff_overview(),public.term_export_manifest(text),public.close_previous_term(text),public.term_purge_manifest(text) to authenticated;
revoke all on function public.record_term_export(text,integer,bigint),public.record_term_purge(text) from public,anon,authenticated;
grant execute on function public.record_term_export(text,integer,bigint),public.record_term_purge(text) to service_role;
commit;
