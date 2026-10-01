-- Named test accounts outside Columbia (e.g. the instructor's personal Gmail used to preview the student view).
-- Only rows in this private table bypass the Columbia-domain rule; nobody can edit it from the website.
create table private.test_accounts (
  email text primary key check (email = lower(trim(email))),
  role text not null check (role in ('student', 'observer'))
);
insert into private.test_accounts(email, role) values ('simonsm.oh@gmail.com', 'student');

create or replace function private.current_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
    and u.raw_app_meta_data->>'provider' = 'google'
    and lower(u.email) = lower(auth.jwt()->>'email')
    and (lower(u.email) ~ '^[^@[:space:]]+@(columbia[.]edu|gsb[.]columbia[.]edu)$'
         or exists (select 1 from private.test_accounts t where t.email = lower(u.email)))
$$;
create or replace function private.current_role() returns text
language plpgsql stable security definer set search_path = '' as $$
declare e text := private.current_email(); r text; v_uni text;
begin
  if e is null then return 'unlisted'; end if;
  select role into r from public.allowlist where email = e;
  if r is not null then return r; end if;
  select role into r from private.test_accounts where email = e;
  if r is not null then return r; end if;
  if e like '%@columbia.edu' then v_uni := split_part(e, '@', 1);
  else select uni into v_uni from public.profiles where id = auth.uid(); end if;
  if exists (select 1 from public.roster where uni = v_uni) then return 'student'; end if;
  return 'unlisted';
end $$;
