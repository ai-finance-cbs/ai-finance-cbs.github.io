-- M2 stays on the course site. Canvas remains the grade record.
begin;

create function private.valid_task_map(j jsonb, tasks jsonb, ahead jsonb, ai text, submitted boolean)
returns boolean language plpgsql immutable set search_path='' as $$
declare part jsonb; field text; cap integer; complete integer:=0;
begin
  if jsonb_typeof(j) is distinct from 'object' or jsonb_typeof(tasks) is distinct from 'array'
    or jsonb_typeof(ahead) is distinct from 'object' or ai is null or length(ai)>600 then return false; end if;
  if jsonb_array_length(tasks)>12 or exists(select 1 from jsonb_object_keys(j) k where k not in ('firm_type','role','duration')) then return false; end if;
  foreach field in array array['firm_type','role','duration'] loop
    if jsonb_typeof(j->field) is distinct from 'string' or length(j->>field)>120 then return false; end if;
  end loop;
  -- Null labels are empty draft selections. Any other label must be a full, fixed word.
  for part in select value from jsonb_array_elements(tasks || jsonb_build_array(ahead)) loop
    if jsonb_typeof(part) is distinct from 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(part) k where k not in ('name','description','label','reasoning')) then return false; end if;
    foreach field in array array['name','description'] loop
      cap:=case field when 'name' then 80 else 400 end;
      if jsonb_typeof(part->field) is distinct from 'string' or length(part->>field)>cap then return false; end if;
    end loop;
    if not (part ? 'label') or (part->'label'<>'null'::jsonb and
      (jsonb_typeof(part->'label')<>'string' or part->>'label' not in ('Process','Predict','Persuade','Own'))) then return false; end if;
    if part ? 'reasoning' and (jsonb_typeof(part->'reasoning') is distinct from 'string' or length(part->>'reasoning')>2000) then return false; end if;
  end loop;
  -- Task rows cannot smuggle unbounded or unrelated fields into the stored document.
  if exists(select 1 from jsonb_array_elements(tasks) t where t ? 'reasoning') then return false; end if;
  if jsonb_typeof(ahead->'reasoning') is distinct from 'string' then return false; end if;
  if submitted then
    select count(*) into complete from jsonb_array_elements(tasks) t where
      t->>'name' ~ '[^[:space:]]' and t->>'description' ~ '[^[:space:]]' and t->>'label' in ('Process','Predict','Persuade','Own');
    if complete<8 or not coalesce(ahead->>'name' ~ '[^[:space:]]',false)
      or not coalesce(ahead->>'description' ~ '[^[:space:]]',false)
      or not coalesce(ahead->>'label' in ('Process','Predict','Persuade','Own'),false)
      or not coalesce(ahead->>'reasoning' ~ '[^[:space:]]',false) or not (ai ~ '[^[:space:]]') then return false; end if;
  end if;
  return true;
end $$;

create table public.task_map_submissions (
  term_id text not null references public.terms(id),
  uni text not null check(uni ~ '^[a-z]{1,8}[0-9]{1,8}$'),
  job jsonb not null, tasks jsonb not null, look_ahead jsonb not null, ai_use text not null,
  status text not null check(status in ('draft','submitted')),
  submitted_at timestamptz, updated_at timestamptz not null default clock_timestamp(),
  primary key(term_id,uni),
  check((status='submitted') = (submitted_at is not null)),
  check(private.valid_task_map(job,tasks,look_ahead,ai_use,status='submitted'))
);
alter table public.task_map_submissions enable row level security;
revoke all on public.task_map_submissions from public,anon,authenticated;
create trigger preview_guard before insert or update or delete on public.task_map_submissions
  for each row execute function private.block_preview_write();
create trigger change_audit after insert or update or delete on public.task_map_submissions
  for each row execute function private.audit_class_change();

create function public.save_task_map(p_term text,p_payload jsonb,p_submit boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u text:=private.current_uni(); due timestamptz; term_status text; saved public.task_map_submissions;
begin
  perform private.assert_writable();
  if private.current_role()<>'student' or u is null or not private.can_read_term(p_term) then raise exception 'Student access required for this term.'; end if;
  -- Serialize a student's saves before checking the deadline; lock the settings used by this write.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('task-map:'||p_term||':'||u,0));
  select status into term_status from public.terms where id=p_term for share;
  if term_status is distinct from 'active' then raise exception 'Archived term is read-only.'; end if;
  if p_submit is null or jsonb_typeof(p_payload) is distinct from 'object' or
    not private.valid_task_map(p_payload->'job',p_payload->'tasks',p_payload->'look_ahead',
      case when jsonb_typeof(p_payload->'ai_use')='string' then p_payload->>'ai_use' end,p_submit)
    then raise exception 'Invalid task map. Submit requires at least 8 complete tasks, a complete look-ahead, and AI use; check text limits and labels.'; end if;
  select due_at into due from public.grade_items where term_id=p_term and code='M2' for share;
  if due is null then raise exception 'Submission deadline unavailable.'; end if;
  if clock_timestamp()>=due then raise exception 'Submissions closed.'; end if;
  insert into public.task_map_submissions(term_id,uni,job,tasks,look_ahead,ai_use,status,submitted_at)
  values(p_term,u,p_payload->'job',p_payload->'tasks',p_payload->'look_ahead',p_payload->>'ai_use',
    case when p_submit then 'submitted' else 'draft' end,case when p_submit then clock_timestamp() end)
  on conflict(term_id,uni) do update set job=excluded.job,tasks=excluded.tasks,look_ahead=excluded.look_ahead,
    ai_use=excluded.ai_use,status=excluded.status,submitted_at=excluded.submitted_at,updated_at=clock_timestamp()
  returning * into saved;
  return to_jsonb(saved);
end $$;

create function public.my_task_map(p_term text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if private.current_role()<>'student' or private.current_uni() is null or not private.can_read_term(p_term)
    or (private.preview_uni() is not null and p_term is distinct from private.current_term()) then raise exception 'Student access required for this term.'; end if;
  return jsonb_build_object('submission',(select to_jsonb(s) from public.task_map_submissions s where term_id=p_term and uni=private.current_uni()),
    'due_at',(select due_at from public.grade_items where term_id=p_term and code='M2'),
    'read_only',private.preview_uni() is not null or (select status<>'active' from public.terms where id=p_term));
end $$;

create function public.task_map_class(p_term text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if private.current_role() not in ('instructor','grader') or not private.can_read_term(p_term) then raise exception 'Staff access required for this term.'; end if;
  return jsonb_build_object('students',coalesce((select jsonb_agg(jsonb_build_object('uni',r.uni,'name',r.name,'submission',to_jsonb(s)) order by r.name,r.uni)
    from private.term_roster(p_term) r left join public.task_map_submissions s on s.term_id=p_term and s.uni=r.uni),'[]'::jsonb),
    -- Preserve access to work even if a later roster replacement removed its author.
    'unrostered',coalesce((select jsonb_agg(jsonb_build_object('uni',s.uni,'name',s.uni,'submission',to_jsonb(s)) order by s.uni)
      from public.task_map_submissions s where s.term_id=p_term and not exists(select 1 from private.term_roster(p_term) r where r.uni=s.uni)),'[]'::jsonb));
end $$;
revoke all on function private.valid_task_map(jsonb,jsonb,jsonb,text,boolean) from public,anon,authenticated;
revoke all on function public.save_task_map(text,jsonb,boolean),public.my_task_map(text),public.task_map_class(text) from public,anon,authenticated;
grant execute on function public.save_task_map(text,jsonb,boolean),public.my_task_map(text),public.task_map_class(text) to authenticated;
commit;
