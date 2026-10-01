-- Apply with 003 after review. No hosted migration was run during this task.
begin;

-- An Auth email change alone cannot prove ownership of a Google email address.
create or replace function private.current_email() returns text
language sql stable security definer set search_path='' as $$
  select lower(u.email) from auth.users u
  where u.id=auth.uid() and u.email_confirmed_at is not null
    and u.raw_app_meta_data->>'provider'='google'
    and lower(u.email)=lower(auth.jwt()->>'email')
    and exists (
      select 1 from auth.identities i
      where i.user_id=u.id and i.provider='google'
        and lower(i.identity_data->>'email')=lower(u.email)
        and coalesce((i.identity_data->>'email_verified')::boolean,false)
    )
    and (lower(u.email) ~ '^[^@[:space:]]+@(columbia[.]edu|gsb[.]columbia[.]edu)$'
      or exists(select 1 from private.test_accounts t where t.email=lower(u.email)))
$$;
revoke all on function private.current_email() from public,anon,authenticated;

-- Raw attendance contains quiz provenance. Students use the masked RPC projection only.
-- This also prevents filtering/counting raw rows by an unreleased quiz or manual_override.
drop policy attendance_read on public.attendance;
create policy attendance_read on public.attendance for select to authenticated
  using(private.current_role() in ('instructor','grader'));

-- Hide both provenance fields unless the corresponding quiz has been released.
-- Apply the same mask to ordinary manual records so null cannot signal a hidden score.
create or replace function private.student_snapshot(u text) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object(
  'sessions',(select coalesce(jsonb_agg(s order by week),'[]') from public.attendance_sessions s),
  'attendance',(select coalesce(jsonb_agg(jsonb_build_object(
    'uni',a.uni,'week',a.week,'status',a.status,
    'source_quiz',case when i.released then a.source_quiz else null end,
    'manual_override',case when i.released then a.manual_override else null end
  ) order by a.week),'[]') from public.attendance a
    left join public.grade_items i on i.quiz_week=a.source_quiz where a.uni=u),
  'items',(select coalesce(jsonb_agg(i order by id),'[]') from public.grade_items i where released),
  'grades',(select coalesce(jsonb_agg(g),'[]') from public.grades g join public.grade_items i on i.id=g.item_id where g.uni=u and i.released),
  'sets',(select coalesce(jsonb_agg(s order by created_at),'[]') from public.group_sets s),
  'groups',(select coalesce(jsonb_agg(g order by number),'[]') from public.class_groups g),
  'members',(select coalesce(jsonb_agg(jsonb_build_object('set_id',m.set_id,'group_id',m.group_id,'uni',case when m.uni=u then u else null end,'name',case when exists(select 1 from public.group_memberships mine where mine.uni=u and mine.group_id=m.group_id) then coalesce(nullif(r.name,''),'Student') else null end,
    'email',case when exists(select 1 from public.group_memberships mine where mine.set_id=m.set_id and mine.uni=u and mine.group_id=m.group_id) then r.email else null end)),'[]')
    from public.group_memberships m join private.class_roster() r on r.uni=m.uni),
  'assignments',(select coalesce(jsonb_agg(a order by id),'[]') from public.assignments a),
  'files',(select coalesce(jsonb_agg(f order by created_at),'[]') from public.lecture_files f)
)
$$;
-- Instructor-approved account links replace self-claims. No browser flow needs this RPC.
drop function public.claim_uni(text);

-- Supabase grants anon EXECUTE directly by default. Revoking PUBLIC is insufficient.
-- Name the application RPCs explicitly; leave unrelated public/extension functions alone.
revoke all on function
  public.get_access(), public.replace_roster(jsonb), public.set_student_preview(text),
  public.set_session_date(integer,date), public.save_attendance(integer,jsonb),
  public.save_grades(jsonb), public.release_grade_item(integer,boolean),
  public.create_group_set(text,integer,integer,timestamptz),
  public.update_group_set(uuid,boolean,timestamptz), public.choose_group(uuid,uuid,text),
  public.view_as_student(text), public.class_data(), public.list_test_accounts(),
  public.link_student_account(text,text), public.list_student_accounts()
from public,anon;
revoke all on function private.student_snapshot(text) from public,anon,authenticated;

-- Named test accounts belong in the ignored supabase/private/test-accounts.sql seed.
-- Existing rows are preserved; this migration contains no account addresses or seed inserts.
commit;
