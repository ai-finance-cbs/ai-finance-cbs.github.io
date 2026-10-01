-- Local migration only. Apply after review.
begin;

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null default '' check(char_length(title) <= 200),
  body text not null check(char_length(btrim(body)) > 0 and char_length(body) <= 2000),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.announcements enable row level security;
-- Supabase grants tables broadly by default. Grant only the needed operations and columns.
revoke all on public.announcements from public, anon, authenticated;
grant select, delete on public.announcements to authenticated;
grant insert(title,body), update(title,body) on public.announcements to authenticated;
create policy announcements_read on public.announcements for select to authenticated
  using(private.current_role() in ('student','auditor','grader','instructor'));
create policy announcements_insert on public.announcements for insert to authenticated
  with check(private.current_role()='instructor');
create policy announcements_update on public.announcements for update to authenticated
  using(private.current_role()='instructor') with check(private.current_role()='instructor');
create policy announcements_delete on public.announcements for delete to authenticated
  using(private.current_role()='instructor');
create trigger preview_guard before insert or update or delete on public.announcements
  for each row execute function private.block_preview_write();
create trigger announcements_audit after insert or update or delete on public.announcements
  for each row execute function private.audit_class_change();

-- Auditors need the next class date, but still cannot read attendance or grades.
drop policy sessions_read on public.attendance_sessions;
create policy sessions_read on public.attendance_sessions for select to authenticated
  using(private.current_role() in ('student','auditor','grader','instructor'));

commit;
