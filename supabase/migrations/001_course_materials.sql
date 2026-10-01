-- Course content lives in Postgres, never in the Jekyll output.
-- Run once in Supabase SQL Editor. The application uses only the publishable key.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  uni text check (uni ~ '^[a-z]{1,8}[0-9]{1,8}$'),
  created_at timestamptz not null default now()
);
create table public.roster (
  uni text primary key check (uni ~ '^[a-z]{1,8}[0-9]{1,8}$'),
  name text not null default '' check (length(name) <= 200)
);
create table public.allowlist (
  email text primary key check (email = lower(trim(email)) and email ~ '^[^@[:space:]]+@(columbia[.]edu|gsb[.]columbia[.]edu)$'),
  role text not null check (role in ('instructor_ta', 'observer')),
  constraint keep_owner check (email <> 'oh@gsb.columbia.edu' or role = 'instructor_ta')
);
create table public.assignments (
  id integer primary key check (id between 1 and 6),
  title text not null check (length(title) between 1 and 200),
  due text not null check (length(due) between 1 and 100),
  points integer not null check (points between 0 and 100),
  description text not null check (length(description) <= 20000),
  deliverable text not null check (length(deliverable) <= 10000),
  grading text not null check (length(grading) <= 10000),
  observer_visible boolean not null default false
);
create table public.lecture_files (
  id uuid primary key default gen_random_uuid(),
  week integer not null check (week between 1 and 6),
  title text not null check (length(title) between 1 and 200),
  storage_path text not null unique check (storage_path ~ '^[a-zA-Z0-9/_-]+[.]pdf$'),
  observer_visible boolean not null default false,
  created_at timestamptz not null default now()
);

-- Read immutable Auth records, not editable user metadata or a client-supplied email.
-- The JWT email must agree with the verified Google account as well.
create function private.current_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
    and u.raw_app_meta_data->>'provider' = 'google'
    and lower(u.email) = lower(auth.jwt()->>'email')
    and lower(u.email) ~ '^[^@[:space:]]+@(columbia[.]edu|gsb[.]columbia[.]edu)$'
$$;
create function private.current_role() returns text
language plpgsql stable security definer set search_path = '' as $$
declare e text := private.current_email(); r text; v_uni text;
begin
  if e is null then return 'unlisted'; end if;
  select role into r from public.allowlist where email = e;
  if r is not null then return r; end if;
  if e like '%@columbia.edu' then v_uni := split_part(e, '@', 1);
  else select uni into v_uni from public.profiles where id = auth.uid(); end if;
  if exists (select 1 from public.roster where uni = v_uni) then return 'student'; end if;
  return 'unlisted';
end $$;
revoke all on function private.current_email(), private.current_role() from public;
grant execute on function private.current_role() to authenticated;

-- The only profile writes are these narrowly scoped functions.
create function public.get_access() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e text := private.current_email(); v_uni text; r text;
begin
  if e is null then raise exception 'Sign in with a verified Columbia Google account.'; end if;
  if e like '%@columbia.edu' and split_part(e, '@', 1) ~ '^[a-z]{1,8}[0-9]{1,8}$'
    then v_uni := split_part(e, '@', 1); end if;
  insert into public.profiles(id, email, uni) values(auth.uid(), e, v_uni)
    on conflict (id) do update set email = excluded.email;
  select uni into v_uni from public.profiles where id = auth.uid();
  r := private.current_role();
  return jsonb_build_object('email', e, 'uni', v_uni, 'role', r,
    'needs_uni', e like '%@gsb.columbia.edu' and v_uni is null and r = 'unlisted');
end $$;
create function public.claim_uni(proposed_uni text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e text := private.current_email(); cleaned text := lower(trim(proposed_uni)); old_uni text;
begin
  if e is null or e not like '%@gsb.columbia.edu' then raise exception 'A Columbia Business School Google account is required.'; end if;
  perform public.get_access();
  select uni into old_uni from public.profiles where id = auth.uid() for update;
  if old_uni is not null then raise exception 'Your UNI is already saved. Contact oh@gsb.columbia.edu for a correction.'; end if;
  if cleaned !~ '^[a-z]{1,8}[0-9]{1,8}$' or not exists (select 1 from public.roster where uni = cleaned)
    then raise exception 'You are not on the class list. Contact oh@gsb.columbia.edu.'; end if;
  update public.profiles set uni = cleaned where id = auth.uid();
  return public.get_access();
end $$;
-- Replacing the roster is one transaction. A failed import keeps the old roster.
create function public.replace_roster(rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if private.current_role() <> 'instructor_ta' then raise exception 'Instructor access required.'; end if;
  if rows is null or jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) not between 1 and 5000
    then raise exception 'Provide 1 to 5000 valid roster rows.'; end if;
  if exists (select 1 from jsonb_to_recordset(rows) as x(uni text, name text)
    where uni is null or uni !~ '^[a-z]{1,8}[0-9]{1,8}$' or length(coalesce(name, '')) > 200)
    then raise exception 'Invalid roster row.'; end if;
  lock table public.roster in exclusive mode;
  delete from public.roster;
  insert into public.roster(uni, name)
    select uni, coalesce(name, '') from jsonb_to_recordset(rows) as x(uni text, name text);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.get_access(), public.claim_uni(text), public.replace_roster(jsonb) from public;
grant execute on function public.get_access(), public.claim_uni(text), public.replace_roster(jsonb) to authenticated;

alter table public.profiles enable row level security;
alter table public.roster enable row level security;
alter table public.allowlist enable row level security;
alter table public.assignments enable row level security;
alter table public.lecture_files enable row level security;
revoke all on public.profiles, public.roster, public.allowlist, public.assignments, public.lecture_files from anon, authenticated;
grant select on public.profiles, public.roster to authenticated;
grant select, insert, update, delete on public.allowlist, public.assignments, public.lecture_files to authenticated;
create policy profile_read on public.profiles for select to authenticated using (
  (id = auth.uid() and private.current_role() <> 'unlisted') or private.current_role() = 'instructor_ta'
);
create policy roster_read on public.roster for select to authenticated using (private.current_role() = 'instructor_ta');
create policy allowlist_read on public.allowlist for select to authenticated using (private.current_role() = 'instructor_ta');
create policy allowlist_insert on public.allowlist for insert to authenticated with check (private.current_role() = 'instructor_ta');
create policy allowlist_update on public.allowlist for update to authenticated using (private.current_role() = 'instructor_ta' and email <> 'oh@gsb.columbia.edu') with check (private.current_role() = 'instructor_ta' and email <> 'oh@gsb.columbia.edu');
create policy allowlist_delete on public.allowlist for delete to authenticated using (private.current_role() = 'instructor_ta' and email <> 'oh@gsb.columbia.edu');
create policy assignment_read on public.assignments for select to authenticated using (
  private.current_role() in ('instructor_ta', 'student') or (private.current_role() = 'observer' and observer_visible)
);
create policy assignment_write on public.assignments for all to authenticated using (private.current_role() = 'instructor_ta') with check (private.current_role() = 'instructor_ta');
create policy lecture_read on public.lecture_files for select to authenticated using (
  private.current_role() in ('instructor_ta', 'student') or (private.current_role() = 'observer' and observer_visible)
);
create policy lecture_write on public.lecture_files for all to authenticated using (private.current_role() = 'instructor_ta') with check (private.current_role() = 'instructor_ta');

insert into public.allowlist(email, role) values ('oh@gsb.columbia.edu', 'instructor_ta');
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('lecture-notes', 'lecture-notes', false, 20971520, array['application/pdf']);
-- Deny direct reads/signing for browser users, including instructors.
-- The Edge Function checks the caller's role and metadata under RLS, then signs for 300 seconds.
create policy lecture_object_no_direct_read on storage.objects as restrictive for select to anon, authenticated using (bucket_id <> 'lecture-notes');
create policy lecture_object_insert on storage.objects for insert to authenticated with check (bucket_id = 'lecture-notes' and private.current_role() = 'instructor_ta');
-- Deletion and failed-upload cleanup also go through the instructor-checked function.
commit;
