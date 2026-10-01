-- Phase A, U4. Scores and comments share the existing release boundary.
begin;
alter table public.grades add column comment text check(length(comment)<=10000);

-- Lock settings, linked sets, then owners in one fixed order. Include possible owners
-- without submissions, so a first finish and an early score use the same lock.
create function private.lock_item_submissions(p_items integer[]) returns void
language plpgsql security definer set search_path='' as $$
declare s record; t text:=private.active_term();
begin
  perform 1 from public.grade_items where term_id=t and id=any(p_items) order by id for share;
  perform 1 from public.group_sets where term_id=t and id in (
    select group_set_id from public.grade_items where term_id=t and id=any(p_items) and mode='group') order by id for update;
  for s in select * from (
    select term_id,item_id,owner_uni,group_id from public.submissions where term_id=t and item_id=any(p_items)
    union
    select t,i.id,r.uni,null::uuid from public.grade_items i cross join private.term_roster(t) r
      where i.term_id=t and i.id=any(p_items) and i.mode='individual' and i.kind<>'none'
    union
    select t,i.id,null::text,g.id from public.grade_items i join public.class_groups g on g.term_id=t and g.set_id=i.group_set_id
      where i.term_id=t and i.id=any(p_items) and i.mode='group' and i.kind<>'none'
  ) owners order by term_id,item_id,coalesce(owner_uni,group_id::text) loop
    perform private.submission_lock(s.term_id,s.item_id,s.owner_uni,s.group_id);
  end loop;
end $$;
create function private.refresh_submission_locks(p_items integer[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Preserve the original lock time. Do not audit a no-op on another student's work.
  with state as (
    select s.id,s.term_id,exists(select 1 from public.grades g where g.term_id=s.term_id
      and g.item_id=s.item_id and g.uni=any(s.member_unis)) has_grade
    from public.submissions s where s.term_id=private.active_term() and s.item_id=any(p_items)
  )
  update public.submissions s set graded_at=case when state.has_grade then clock_timestamp() else null end
    from state where s.term_id=state.term_id and s.id=state.id and (s.graded_at is not null) is distinct from state.has_grade;
end $$;
create or replace function public.save_grades(entries jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare e record; maximum numeric; q integer; t text:=private.active_term(); ids integer[];
begin
  perform private.assert_writable(); perform private.require_grader();
  if entries is null or jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>80000 then raise exception 'Invalid grade rows.'; end if;
  select array_agg(distinct (value->>'item_id')::integer) into ids from jsonb_array_elements(entries);
  perform private.lock_item_submissions(ids);
  for e in select value v,value->>'uni' uni,(value->>'item_id')::integer item_id,(value->>'score')::numeric score,value->>'comment' comment
    from jsonb_array_elements(entries) order by value->>'uni',(value->>'item_id')::integer loop
    perform pg_advisory_xact_lock(hashtextextended(t||':student:'||e.uni,0));
    if not exists(select 1 from private.term_roster(t) r where r.uni=e.uni) then raise exception 'Unknown UNI: %',e.uni; end if;
    select max_points,quiz_week into maximum,q from public.grade_items where term_id=t and id=e.item_id;
    if maximum is null or (e.score is not null and (e.score<0 or e.score>maximum or e.score::text in ('NaN','Infinity','-Infinity') or e.score<>round(e.score,2))) then raise exception 'Invalid score for item %.',e.item_id; end if;
    if e.score is null then delete from public.grades where term_id=t and uni=e.uni and item_id=e.item_id;
    else insert into public.grades(term_id,uni,item_id,score,comment) values(t,e.uni,e.item_id,e.score,e.comment)
      on conflict(term_id,uni,item_id) do update set score=excluded.score,
        comment=case when e.v ? 'comment' then excluded.comment else public.grades.comment end; end if;
    if q is not null then
      if e.score is null then
        delete from public.attendance where term_id=t and uni=e.uni and week=q and source_quiz=q and not manual_override;
        update public.attendance set source_quiz=null where term_id=t and uni=e.uni and week=q;
      else insert into public.attendance(term_id,uni,week,status,source_quiz) values(t,e.uni,q,'present',q)
        on conflict(term_id,uni,week) do update set source_quiz=q,
          status=case when public.attendance.manual_override then public.attendance.status else 'present' end;
      end if;
    end if;
  end loop;
  perform private.refresh_submission_locks(ids);
end $$;
create function public.grade_group(p_item integer,p_group uuid,p_score numeric,p_comment text default null) returns void
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
  perform private.refresh_submission_locks(array[p_item]);
end $$;

-- Status is separate from released grades. Expose item metadata without any score/comment.
create function private.submission_snapshot(t text,u text,r text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'submission_items',(select coalesce(jsonb_agg(case when r='student' then
      jsonb_build_object('id',i.id,'term_id',i.term_id,'code',i.code,'title',i.title,'kind',i.kind,'mode',i.mode,
        'group_set_id',i.group_set_id,'due_at',i.due_at,'locked',private.submission_is_graded(t,i.id,
          case when i.mode='individual' then u end,
          (select m.group_id from public.group_memberships m where m.term_id=t and m.set_id=i.group_set_id and m.uni=u)))
      else to_jsonb(i) end order by id),'[]') from public.grade_items i
      where i.term_id=t and (r in ('instructor','grader') or (r='student' and i.kind<>'none'))),
    'submissions',(select coalesce(jsonb_agg((case when r='student' then to_jsonb(s)-'member_unis'-'submitted_by'-'graded_at' else to_jsonb(s) end)||jsonb_build_object('locked',private.submission_is_graded(t,s.item_id,s.owner_uni,s.group_id),'status',case when s.late then 'Late' else 'Submitted' end,
      'membership_changed',case when r in ('instructor','grader') and s.group_id is not null then
        s.member_unis is distinct from (select array_agg(m.uni order by m.uni) from public.group_memberships m join private.term_roster(t) c on c.uni=m.uni where m.term_id=t and m.group_id=s.group_id)
        else false end)),'[]') from public.submissions s where s.term_id=t and (r in ('instructor','grader') or (r='student' and
          (s.owner_uni=u or exists(select 1 from public.group_memberships m where m.term_id=t and m.group_id=s.group_id and m.uni=u)))))
  )
$$;
create or replace function private.student_snapshot(u text) returns jsonb
language sql stable security definer set search_path='' as $$
  select private.term_snapshot(private.current_term(),u,'student')||private.submission_snapshot(private.current_term(),u,'student')
    where private.can_read_term(private.current_term())
$$;
create or replace function public.class_data(p_term text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t text:=coalesce(p_term,private.current_term()); r text:=private.current_role(); u text:=private.current_uni();
begin
  if not private.can_read_term(t) then raise exception 'Class access required for this term.'; end if;
  return private.term_snapshot(t,u,r)||private.submission_snapshot(t,u,r);
end $$;
revoke all on function private.lock_item_submissions(integer[]),private.refresh_submission_locks(integer[]),private.submission_snapshot(text,text,text) from public,anon,authenticated;
revoke all on function public.grade_group(integer,uuid,numeric,text) from public,anon;
grant execute on function public.grade_group(integer,uuid,numeric,text) to authenticated;
commit;
