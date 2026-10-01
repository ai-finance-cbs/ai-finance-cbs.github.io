-- Global instructor workspace: these records do not belong to a term.
begin;

create table public.instructor_notes (
  week integer primary key check(week between 1 and 6),
  body text not null default '' check(char_length(body) <= 50000),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.speakers (
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(btrim(name)) > 0 and char_length(name) <= 200),
  affiliation text not null default '' check(char_length(affiliation) <= 300),
  topic text not null default '' check(char_length(topic) <= 500),
  week integer check(week between 1 and 6),
  status text not null default 'Idea' check(status in ('Idea','Contacted','Confirmed','Declined')),
  contact text not null default '' check(char_length(contact) <= 2000),
  notes text not null default '' check(char_length(notes) <= 10000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.instructor_notes enable row level security;
alter table public.speakers enable row level security;
revoke all on public.instructor_notes,public.speakers from public,anon,authenticated;
grant select(week,body,updated_at) on public.instructor_notes to authenticated;
grant select(id,name,affiliation,topic,week,status,contact,notes,created_at,updated_at) on public.speakers to authenticated;
-- Keep actor_role itself private. RLS callers get only this yes/no predicate.
create function private.instructor_workspace() returns boolean
language sql stable security definer set search_path='' as $$
  select private.actor_role()='instructor' and private.preview_uni() is null
$$;
revoke all on function private.instructor_workspace() from public,anon,authenticated;
grant execute on function private.instructor_workspace() to authenticated;
create policy instructor_notes_read on public.instructor_notes for select to authenticated
  using(private.instructor_workspace());
create policy speakers_read on public.speakers for select to authenticated
  using(private.instructor_workspace());

create trigger preview_guard before insert or update or delete on public.instructor_notes
  for each row execute function private.block_preview_write();
create trigger preview_guard before insert or update or delete on public.speakers
  for each row execute function private.block_preview_write();
create trigger change_audit after insert or update or delete on public.instructor_notes
  for each row execute function private.audit_class_change();
create trigger change_audit after insert or update or delete on public.speakers
  for each row execute function private.audit_class_change();

create function public.save_instructor_note(p_week integer,p_body text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.instructor_notes;
begin
  perform private.require_instructor();
  insert into public.instructor_notes(week,body) values(p_week,p_body)
    on conflict(week) do update set body=excluded.body,updated_at=clock_timestamp()
    returning * into saved;
  return to_jsonb(saved);
end $$;

create function public.save_speaker(p_id uuid,p_name text,p_affiliation text,p_topic text,
  p_week integer,p_status text,p_contact text,p_notes text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.speakers;
begin
  perform private.require_instructor();
  if p_id is null then
    insert into public.speakers(name,affiliation,topic,week,status,contact,notes)
      values(btrim(p_name),p_affiliation,p_topic,p_week,p_status,p_contact,p_notes)
      returning * into saved;
  else
    update public.speakers set name=btrim(p_name),affiliation=p_affiliation,topic=p_topic,
      week=p_week,status=p_status,contact=p_contact,notes=p_notes,updated_at=clock_timestamp()
      where id=p_id returning * into saved;
    if not found then raise exception 'Speaker not found.'; end if;
  end if;
  return to_jsonb(saved);
end $$;

create function public.delete_speaker(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_instructor();
  delete from public.speakers where id=p_id;
  if not found then raise exception 'Speaker not found.'; end if;
end $$;

revoke all on function public.save_instructor_note(integer,text),
  public.save_speaker(uuid,text,text,text,integer,text,text,text),public.delete_speaker(uuid)
  from public,anon,authenticated;
grant execute on function public.save_instructor_note(integer,text),
  public.save_speaker(uuid,text,text,text,integer,text,text,text),public.delete_speaker(uuid)
  to authenticated;
commit;
