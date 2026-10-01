-- Phase B review: separate class handouts from lecture notes without encoding type in a title.
begin;
alter table public.lecture_files
  add column category text not null default 'notes'
  check (category in ('in_class','notes'));

update public.lecture_files
set category='in_class',
    title=coalesce(nullif(btrim(regexp_replace(title,'^in-class[[:space:]]*:[[:space:]]*','','i')),''),'Untitled file')
where title ~* '^in-class[[:space:]]*:';

-- Existing SELECT grants and jsonb_agg(f) in private.term_snapshot include the new column.
-- class_data and student_snapshot use that projection with the same release, auditor, and term predicates.
-- Add only the editable column grants. Existing RLS and preview guards still control every write.
grant insert(category), update(category) on public.lecture_files to authenticated;
commit;
