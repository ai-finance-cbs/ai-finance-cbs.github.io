-- The website link belongs to the Canvas group, even when its members change.
begin;
create table public.group_link_submissions (
  term_id text not null references public.terms(id),
  code text not null check(code='M3'),
  -- No group foreign key: a later Canvas sync may remove a group from the mirror.
  canvas_group_id bigint not null check(canvas_group_id>0),
  link text not null check(length(link)<=2000 and link ~* '^https://[^/?#[:space:]\\]+([/?#][^[:space:]\\]*)?$'),
  submitted_by_uni text not null check(submitted_by_uni ~ '^[a-z]{1,8}[0-9]{1,8}$'),
  submitted_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(term_id,code,canvas_group_id)
);
alter table public.group_link_submissions enable row level security;
revoke all on public.group_link_submissions from public,anon,authenticated;
create trigger preview_guard before insert or update or delete on public.group_link_submissions
  for each row execute function private.block_preview_write();
create trigger change_audit after insert or update or delete on public.group_link_submissions
  for each row execute function private.audit_class_change();

-- Shared by the RPCs and the defensive SELECT policy. Never accepts a UNI or group ID.
create function private.group_link_context(t text,c text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare category bigint; student jsonb; groups jsonb; g jsonb; due timestamptz; locked boolean;
begin
  if c is distinct from 'M3' then raise exception 'Invalid group submission code.'; end if;
  if private.current_role()<>'student' or private.current_uni() is null or not private.can_read_term(t)
    or (private.preview_uni() is not null and t is distinct from private.current_term()) then
    raise exception 'Student access required for this term.';
  end if;
  select a.group_category_id into category from public.canvas_assignment_map m
    join public.canvas_assignments a on a.term_id=m.term_id and a.id=m.canvas_assignment_id
    where m.term_id=t and m.site_key=c;
  student:=public.canvas_student_data(t);
  select (i->>'due_at')::timestamptz into due from jsonb_array_elements(student->'items') i where i->>'site_key'=c;
  select jsonb_agg(x) into groups from jsonb_array_elements(student->'groups') x where (x->>'category_id')::bigint=category;
  -- Ambiguous mirror identities or multiple memberships must not choose an arbitrary group.
  if jsonb_array_length(groups)=1 and (select count(*) from public.canvas_enrollments e
    where e.term_id=t and e.uni=private.current_uni() and e.match_status='matched')=1 then g:=groups->0; end if;
  locked:=private.preview_uni() is not null or (select status<>'active' from public.terms where id=t);
  return jsonb_build_object('setup',category is not null,'available',student->'available','group',g,'due_at',due,
    'read_only',locked,'closed',due is null or now()>=due);
end $$;
create policy group_link_read on public.group_link_submissions for select to authenticated using(
  private.can_read_term(term_id) and case
    when private.current_role() in ('instructor','grader') then private.preview_uni() is null
    when private.current_role()='student' then canvas_group_id=(private.group_link_context(term_id,code)->'group'->>'id')::bigint
    else false end
);

create function public.my_group_link(p_term text,p_code text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare context jsonb; row jsonb;
begin
  context:=private.group_link_context(p_term,p_code);
  select to_jsonb(s)||jsonb_build_object('submitted_by_name',coalesce(
    (select r.name from public.roster r where r.term_id=p_term and r.uni=s.submitted_by_uni),s.submitted_by_uni)) into row
    from public.group_link_submissions s where s.term_id=p_term and s.code=p_code
      and s.canvas_group_id=(context->'group'->>'id')::bigint;
  return context||jsonb_build_object('submission',row);
end $$;

create function public.save_group_link(p_term text,p_code text,p_link text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; due timestamptz; saved public.group_link_submissions; cleaned text:=btrim(p_link);
begin
  perform private.assert_writable();
  if private.current_role()<>'student' or private.current_uni() is null or not private.can_read_term(p_term) then
    raise exception 'Student access required for this term.';
  end if;
  -- Sync, mapping changes, and other group saves use the same transaction lock.
  -- Resolve membership and deadline after taking it, then upsert once. Last write wins.
  perform private.canvas_lock(p_term);
  context:=private.group_link_context(p_term,p_code);
  if not (context->>'setup')::boolean then raise exception 'Group submission is not set up yet. Email the teaching team.'; end if;
  if not coalesce((context->>'available')::boolean,false) then raise exception 'Canvas group data unavailable. Please contact the teaching team.'; end if;
  if context->'group'='null'::jsonb then raise exception 'Join your group on Canvas first. The site updates after the next Canvas sync.'; end if;
  due:=(context->>'due_at')::timestamptz;
  if due is null then raise exception 'Canvas M3 deadline unavailable. Please contact the teaching team.'; end if;
  if clock_timestamp()>=due then raise exception 'Submissions closed.'; end if;
  if cleaned is null or length(cleaned)>2000 or cleaned !~* '^https://[^/?#[:space:]\\]+([/?#][^[:space:]\\]*)?$' then
    raise exception 'Enter an https:// link of at most 2000 characters.';
  end if;
  insert into public.group_link_submissions(term_id,code,canvas_group_id,link,submitted_by_uni)
    values(p_term,p_code,(context->'group'->>'id')::bigint,cleaned,private.current_uni())
    on conflict(term_id,code,canvas_group_id) do update set link=excluded.link,submitted_by_uni=excluded.submitted_by_uni,
      submitted_at=clock_timestamp(),updated_at=clock_timestamp() returning * into saved;
  return to_jsonb(saved)||jsonb_build_object('submitted_by_name',coalesce(
    (select name from public.roster where term_id=p_term and uni=saved.submitted_by_uni),saved.submitted_by_uni));
end $$;

create function public.group_link_class(p_term text,p_code text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare category bigint; mapped_id bigint; due timestamptz;
begin
  if p_code is distinct from 'M3' then raise exception 'Invalid group submission code.'; end if;
  if private.current_role() not in ('instructor','grader') or private.preview_uni() is not null or not private.can_read_term(p_term) then
    raise exception 'Staff access required for this term.';
  end if;
  select a.group_category_id,a.id,a.due_at into category,mapped_id,due from public.canvas_assignment_map m
    join public.canvas_assignments a on a.term_id=m.term_id and a.id=m.canvas_assignment_id
    where m.term_id=p_term and m.site_key=p_code;
  return jsonb_build_object('setup',category is not null,'due_at',due,'groups',coalesce((
    select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,
      'members',(select coalesce(jsonb_agg(jsonb_build_object('name',gm.name) order by gm.name,gm.user_id),'[]'::jsonb)
        from public.canvas_group_members gm where gm.term_id=p_term and gm.group_id=g.id),
      'submission',case when s.link is not null then to_jsonb(s)||jsonb_build_object('submitted_by_name',coalesce(
        (select r.name from public.roster r where r.term_id=p_term and r.uni=s.submitted_by_uni),s.submitted_by_uni)) end,
      -- Compare with the submitter's effective Canvas deadline, including overrides.
      'late',case when s.link is not null then s.submitted_at>=(select cs.cached_due_at from public.canvas_submissions cs
        join public.canvas_enrollments e on e.term_id=cs.term_id and e.user_id=cs.user_id
        where cs.term_id=p_term and cs.assignment_id=mapped_id and e.uni=s.submitted_by_uni and e.match_status='matched'
        order by e.user_id limit 1) end
    ) order by g.name,g.id) from public.canvas_groups g left join public.group_link_submissions s
      on s.term_id=p_term and s.code=p_code and s.canvas_group_id=g.id
      where g.term_id=p_term and g.category_id=category),'[]'::jsonb));
end $$;
revoke all on function private.group_link_context(text,text) from public,anon,authenticated;
grant execute on function private.group_link_context(text,text) to authenticated;
revoke all on function public.my_group_link(text,text),public.save_group_link(text,text,text),public.group_link_class(text,text) from public,anon,authenticated;
grant execute on function public.my_group_link(text,text),public.save_group_link(text,text,text),public.group_link_class(text,text) to authenticated;
commit;
