begin;

-- Milestones use assignments.auditor_visible. Optional tasks need their own flag.
alter table public.grade_items add column auditor_visible boolean not null default false;
create table public.assignment_pages (
  term_id text not null references public.terms(id) on delete cascade,
  code text not null check(code in ('M1','M2','M3','M4','M5','FP','O1','O2','O3')),
  body_md text not null default '' check(char_length(body_md) <= 50000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(term_id,code),
  foreign key(term_id,code) references public.grade_items(term_id,code) on delete cascade
);
alter table public.assignment_pages enable row level security;
revoke all on public.assignment_pages from public,anon,authenticated;
grant select(term_id,code,body_md,updated_at) on public.assignment_pages to authenticated;

create function private.assignment_page_read(p_term text,p_code text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.can_read_term(p_term) and exists(
    select 1 from public.grade_items i where i.term_id=p_term and i.code=p_code
      and i.code in ('M1','M2','M3','M4','M5','FP','O1','O2','O3')
      and (private.current_role() in ('instructor','grader','student') or
        (private.current_role()='auditor' and case when i.code like 'O%' then i.auditor_visible
          else exists(select 1 from public.assignments a where a.term_id=i.term_id
            and a.id=case when i.code='FP' then 6 when i.code ~ '^M[1-5]$' then substring(i.code from 2)::integer else null end and a.auditor_visible) end)))
$$;
revoke all on function private.assignment_page_read(text,text) from public,anon,authenticated;
grant execute on function private.assignment_page_read(text,text) to authenticated;
create policy assignment_pages_read on public.assignment_pages for select to authenticated
  using(private.assignment_page_read(term_id,code));
create trigger preview_guard before insert or update or delete on public.assignment_pages
  for each row execute function private.block_preview_write();
create trigger change_audit after insert or update or delete on public.assignment_pages
  for each row execute function private.audit_class_change();

-- A small menu projection. No instructions, scores, or submission records enter it.
create function public.assignment_catalog(p_term text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_read_term(p_term) then raise exception 'Class access required for this term.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'code',i.code,
    'title',coalesce(a.title,i.title),'kind',i.kind,'mode',i.mode,'due_at',i.due_at) order by i.id),'[]')
    from public.grade_items i left join public.assignments a on a.term_id=i.term_id
      and a.id=case when i.code='FP' then 6 when i.code ~ '^M[1-5]$' then substring(i.code from 2)::integer else null end
    where i.term_id=p_term and private.assignment_page_read(p_term,i.code));
end $$;

create function public.save_assignment_page(p_term text,p_code text,p_body text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.assignment_pages;
begin
  perform private.require_instructor();
  perform private.assert_writable();
  perform 1 from public.terms where id=p_term and status='active' for share;
  if not found then raise exception 'Archived terms are read-only.'; end if;
  insert into public.assignment_pages(term_id,code,body_md) values(p_term,p_code,p_body)
    on conflict(term_id,code) do update set body_md=excluded.body_md,updated_at=clock_timestamp()
    returning * into saved;
  return to_jsonb(saved);
end $$;
revoke all on function public.assignment_catalog(text),public.save_assignment_page(text,text,text)
  from public,anon,authenticated;
grant execute on function public.assignment_catalog(text),public.save_assignment_page(text,text,text) to authenticated;
commit;
