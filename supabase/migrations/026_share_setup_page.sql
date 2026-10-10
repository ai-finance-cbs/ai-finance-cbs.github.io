begin;

-- Share Your Setup (O4) is presented in class and has no upload, but it still needs an instructions page.
alter table public.assignment_pages drop constraint assignment_pages_code_check;
alter table public.assignment_pages add constraint assignment_pages_code_check
  check(code in ('M1','M2','M3','M4','M5','FP','O1','O2','O3','O4'));

create or replace function private.assignment_page_read(p_term text,p_code text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.can_read_term(p_term) and exists(
    select 1 from public.grade_items i where i.term_id=p_term and i.code=p_code
      and i.code in ('M1','M2','M3','M4','M5','FP','O1','O2','O3','O4')
      and (private.current_role() in ('instructor','grader','student') or
        (private.current_role()='auditor' and case when i.code like 'O%' then i.auditor_visible
          else exists(select 1 from public.assignments a where a.term_id=i.term_id
            and a.id=case when i.code='FP' then 6 when i.code ~ '^M[1-5]$' then substring(i.code from 2)::integer else null end and a.auditor_visible) end)))
$$;

commit;
