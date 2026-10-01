-- Phase C: keep the last group grade separate from per-student overrides.
begin;
create table public.group_grade_records (
  term_id text not null, item_id integer not null, group_id uuid not null,
  score numeric, comment text check(length(comment)<=10000), graded_at timestamptz not null default clock_timestamp(),
  primary key(term_id,item_id,group_id),
  foreign key(term_id,item_id) references public.grade_items(term_id,id),
  foreign key(term_id,group_id) references public.class_groups(term_id,id)
);
alter table public.group_grade_records enable row level security;
revoke all on public.group_grade_records from public,anon,authenticated;
grant select(term_id,item_id,group_id,score,comment,graded_at) on public.group_grade_records to authenticated;
create policy staff_group_grades on public.group_grade_records for select to authenticated
  using(private.current_role() in ('instructor','grader') and private.can_read_term(term_id));
create trigger preview_guard before insert or update or delete on public.group_grade_records for each row execute function private.block_preview_write();
create trigger change_audit after insert or update or delete on public.group_grade_records for each row execute function private.audit_class_change();
create or replace function public.grade_group(p_item integer,p_group uuid,p_score numeric,p_comment text default null) returns void
language plpgsql security definer set search_path='' as $$
declare i public.grade_items; s public.submissions; u text; t text:=private.active_term();
begin
  perform private.assert_writable(); perform private.require_grader();
  select * into i from public.grade_items where term_id=t and id=p_item for share;
  if not found or i.mode<>'group' or not exists(select 1 from public.class_groups g where g.term_id=t and g.id=p_group and g.set_id=i.group_set_id) then raise exception 'Group does not belong to this item set.'; end if;
  perform private.lock_item_submissions(array[p_item]);
  select * into s from public.submissions where term_id=t and item_id=p_item and group_id=p_group for update;
  if not found then raise exception 'No submitted work for this group.'; end if;
  if p_score is not null and (p_score<0 or p_score>i.max_points or p_score::text in ('NaN','Infinity','-Infinity') or p_score<>round(p_score,2)) then raise exception 'Invalid score for item %.',p_item; end if;
  foreach u in array s.member_unis loop
    perform pg_advisory_xact_lock(hashtextextended(t||':student:'||u,0));
    if p_score is null then delete from public.grades where term_id=t and item_id=p_item and uni=u;
    else insert into public.grades(term_id,uni,item_id,score,comment) values(t,u,p_item,p_score,p_comment)
      on conflict(term_id,uni,item_id) do update set score=excluded.score,comment=excluded.comment; end if;
  end loop;
  insert into public.group_grade_records(term_id,item_id,group_id,score,comment)
    values(t,p_item,p_group,p_score,p_comment)
    on conflict(term_id,item_id,group_id) do update set score=excluded.score,comment=excluded.comment,graded_at=clock_timestamp();
  perform private.refresh_submission_locks(array[p_item]);
end $$;

create or replace function public.configure_grade_item(p_item integer,p_kind text,p_mode text,p_group_set uuid,p_due timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare i public.grade_items; t text:=private.active_term();
begin
  perform private.assert_writable(); perform private.require_instructor();
  select * into i from public.grade_items where term_id=t and id=p_item for update;
  if not found then raise exception 'Invalid item.'; end if;
  if exists(select 1 from public.submissions where term_id=t and item_id=p_item) and
    (i.kind is distinct from p_kind or i.mode is distinct from p_mode or i.group_set_id is distinct from p_group_set) then
    raise exception 'Submission mode cannot change after work has been submitted.'; end if;
  if p_mode='group' and p_group_set is null then raise exception 'Choose a group set for group submissions.'; end if;
  update public.grade_items set kind=p_kind,mode=p_mode,group_set_id=p_group_set,due_at=p_due where term_id=t and id=p_item;
end $$;

create or replace function public.class_data(p_term text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t text:=coalesce(p_term,private.current_term()); r text:=private.current_role(); u text:=private.current_uni();
begin
  if not private.can_read_term(t) then raise exception 'Class access required for this term.'; end if;
  return private.term_snapshot(t,u,r)||private.submission_snapshot(t,u,r)||case when r in ('instructor','grader') then
    jsonb_build_object('group_grades',(select coalesce(jsonb_agg(g),'[]') from public.group_grade_records g where g.term_id=t)) else '{}'::jsonb end;
end $$;
revoke all on function public.grade_group(integer,uuid,numeric,text),public.configure_grade_item(integer,text,text,uuid,timestamptz),public.class_data(text) from public,anon;
grant execute on function public.grade_group(integer,uuid,numeric,text),public.configure_grade_item(integer,text,text,uuid,timestamptz),public.class_data(text) to authenticated;
commit;
