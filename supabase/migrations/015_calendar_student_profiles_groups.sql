begin;

create table public.student_notes (
  term_id text not null references public.terms(id) on delete cascade,
  uni text not null,
  body text not null default '' check(char_length(body) <= 10000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(term_id,uni)
);
alter table public.student_notes enable row level security;
revoke all on public.student_notes from public,anon,authenticated;
grant select(term_id,uni,body,updated_at) on public.student_notes to authenticated;
create policy student_notes_read on public.student_notes for select to authenticated
  using(private.instructor_workspace());
create trigger preview_guard before insert or update or delete on public.student_notes
  for each row execute function private.block_preview_write();
-- Private prose must never enter the general audit log.

create function public.save_student_note(p_term text,p_uni text,p_body text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.student_notes;
begin
  perform private.require_instructor();
  perform private.assert_writable();
  -- Lock the term against rollover while this write completes.
  perform 1 from public.terms where id=p_term and status='active' for share;
  if not found then raise exception 'Archived terms are read-only.'; end if;
  if not exists(select 1 from private.term_roster(p_term) where uni=p_uni) then
    raise exception 'Student not found.';
  end if;
  insert into public.student_notes(term_id,uni,body) values(p_term,p_uni,p_body)
    on conflict(term_id,uni) do update set body=excluded.body,updated_at=clock_timestamp()
    returning * into saved;
  return to_jsonb(saved);
end $$;

-- Staff cards can read a student's course email without exposing account mappings.
create function public.student_profile(p_term text,p_uni text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if private.preview_uni() is not null or private.actor_role() not in ('instructor','grader')
    or not private.can_read_term(p_term) then raise exception 'Staff access required.'; end if;
  return (select jsonb_build_object('uni',uni,'name',name,'email',email)
    from private.term_roster(p_term) where uni=p_uni);
end $$;

alter table public.group_sets add column note text not null default ''
  check(char_length(note) <= 500 and note !~ E'[\r\n]');

create function public.set_group_note(p_set uuid,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare t text:=private.active_term();
begin
  perform private.require_instructor();
  perform private.assert_writable();
  perform 1 from public.terms where id=t and status='active' for share;
  if not found then raise exception 'Archived terms are read-only.'; end if;
  update public.group_sets set note=btrim(p_note) where term_id=t and id=p_set;
  if not found then raise exception 'Group set not found in the active term.'; end if;
end $$;

create function public.add_groups(p_set uuid,p_count integer) returns void
language plpgsql security definer set search_path='' as $$
declare t text:=private.active_term(); last_number integer;
begin
  perform private.require_instructor();
  perform private.assert_writable();
  if p_count is null or p_count not between 1 and 100 then raise exception 'Add between 1 and 100 groups.'; end if;
  perform 1 from public.terms where id=t and status='active' for share;
  if not found then raise exception 'Archived terms are read-only.'; end if;
  -- Serialize additions so concurrent requests cannot reuse group numbers.
  perform 1 from public.group_sets where term_id=t and id=p_set for update;
  if not found then raise exception 'Group set not found in the active term.'; end if;
  select coalesce(max(number),0) into last_number from public.class_groups where term_id=t and set_id=p_set;
  insert into public.class_groups(term_id,set_id,number)
    select t,p_set,n from generate_series(last_number+1,last_number+p_count) n;
end $$;

-- One snapshot selects the active term and an explicit public-field allowlist.
-- Only the Edge Function's service client can call this projection.
create function public.calendar_data() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('term_id',t.id,
    'sessions',(select coalesce(jsonb_agg(jsonb_build_object('week',s.week,
      'starts_at',s.starts_at,'ends_at',s.ends_at) order by s.week),'[]')
      from public.attendance_sessions s where s.term_id=t.id and s.week between 1 and 6),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'code',i.code,
      'title',i.title,'due_at',i.due_at) order by i.id),'[]')
      from public.grade_items i where i.term_id=t.id and i.due_at is not null))
  from public.terms t where t.status='active'
$$;

revoke all on function public.save_student_note(text,text,text),public.student_profile(text,text),
  public.set_group_note(uuid,text),public.add_groups(uuid,integer),public.calendar_data()
  from public,anon,authenticated;
grant execute on function public.save_student_note(text,text,text),public.student_profile(text,text),
  public.set_group_note(uuid,text),public.add_groups(uuid,integer) to authenticated;
grant execute on function public.calendar_data() to service_role;

commit;
