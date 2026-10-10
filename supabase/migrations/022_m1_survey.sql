-- M1 responses stay private on the course site. Q9 and Q10 remain separate for Week 6.
begin;
create function private.valid_survey(a jsonb, q9 jsonb, q10 jsonb, submitted boolean)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text; cap text; g jsonb; choice jsonb;
begin
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(q9) is distinct from 'array' then return false; end if;
  if exists(select 1 from jsonb_object_keys(a) f where f not in
    ('full_name','preferred_name','job','career_examples','other_tool','ai_use','wish','worries','other_info','setup_version','setup_haiku','setup_problems','program','sector','setup_assistant','ai_frequency','experience')) then return false; end if;
  for k,cap in select * from jsonb_each_text('{"full_name":120,"preferred_name":120,"job":3000,"career_examples":500,"other_tool":120,"ai_use":1500,"wish":600,"worries":1000,"other_info":2000,"setup_version":500,"setup_haiku":2000,"setup_problems":2000}'::jsonb) loop
    if jsonb_typeof(a->k) is distinct from 'string' or length(a->>k)>cap::integer then return false; end if;
    if submitted and k in ('full_name','preferred_name','job','career_examples','ai_use','wish','setup_version','setup_haiku')
      and not (a->>k ~ '[^[:space:]]') then return false; end if;
  end loop;
  if jsonb_typeof(a->'program') is distinct from 'string' or a->>'program' not in ('','MBA 2027','MBA 2028','EMBA','MS','PhD','Other')
    or jsonb_typeof(a->'sector') is distinct from 'string' or a->>'sector' not in ('','Investment banking','Sales and trading','Asset management / hedge funds','Private equity / VC / private credit','Corporate finance','Consulting','Fintech / tech','Entrepreneurship','Other')
    or jsonb_typeof(a->'setup_assistant') is distinct from 'string' or a->>'setup_assistant' not in ('','Claude Code','Codex','I could not finish setup.') then return false; end if;
  if submitted and (a->>'program'='' or a->>'sector'='' or a->>'setup_assistant'='') then return false; end if;
  g:=a->'ai_frequency';
  if jsonb_typeof(g) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(g))<>6 then return false; end if;
  foreach k in array array['chatgpt','claude','gemini','copilot','perplexity','other'] loop
    if jsonb_typeof(g->k) is distinct from 'string' or g->>k not in ('','Never','Tried it','Monthly','Weekly','Daily') or (submitted and g->>k='') then return false; end if;
  end loop;
  if submitted and g->>'other'<>'Never' and not (a->>'other_tool' ~ '[^[:space:]]') then return false; end if;
  g:=a->'experience';
  if jsonb_typeof(g) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(g))<>5 then return false; end if;
  foreach k in array array['vscode','github','terminal','python_r','excel'] loop
    if jsonb_typeof(g->k) is distinct from 'string' or g->>k not in ('','Never','A little','Comfortable') or (submitted and g->>k='') then return false; end if;
  end loop;
  if jsonb_array_length(q9)>8 or (submitted and jsonb_array_length(q9)=0)
    or (select count(distinct value) from jsonb_array_elements(q9))<>jsonb_array_length(q9) then return false; end if;
  for choice in select value from jsonb_array_elements(q9) loop
    if jsonb_typeof(choice)<>'string' or choice #>> '{}' not in ('change_work','overhyped','augment','entry_jobs','builders_gain','efficient_markets','stability_risks','unsure') then return false; end if;
  end loop;
  if q10 is null or q10='null'::jsonb then return not submitted; end if;
  if jsonb_typeof(q10)<>'number' then return false; end if;
  return (q10 #>> '{}')::numeric between 0 and 100;
end $$;

create table public.m1_survey_responses (
  term_id text not null references public.terms(id),
  uni text not null check(uni ~ '^[a-z]{1,8}[0-9]{1,8}$'),
  answers jsonb not null, q9 jsonb not null, q10 numeric,
  status text not null check(status in ('draft','submitted')),
  submitted_at timestamptz, updated_at timestamptz not null default clock_timestamp(),
  primary key(term_id,uni),
  check((status='submitted')=(submitted_at is not null)),
  check(private.valid_survey(answers,q9,to_jsonb(q10),status='submitted'))
);
alter table public.m1_survey_responses enable row level security;
revoke all on public.m1_survey_responses from public,anon,authenticated;
create trigger preview_guard before insert or update or delete on public.m1_survey_responses
  for each row execute function private.block_preview_write();
create trigger change_audit after insert or update or delete on public.m1_survey_responses
  for each row execute function private.audit_class_change();

-- Reuse the exact student projection: it checks sync health, visibility, enrollment, and individual due dates.
create function private.survey_due(t text) returns timestamptz
language sql stable security definer set search_path='' as $$
  select (item->>'due_at')::timestamptz from jsonb_array_elements(public.canvas_student_data(t)->'items') item where item->>'site_key'='M1'
$$;
create function public.save_m1_survey(p_term text,p_payload jsonb,p_submit boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u text:=private.current_uni(); due timestamptz; saved public.m1_survey_responses;
begin
  perform private.assert_writable();
  if private.current_role()<>'student' or u is null or not private.can_read_term(p_term) then raise exception 'Student access required for this term.'; end if;
  if p_submit is null or jsonb_typeof(p_payload) is distinct from 'object' or not (p_payload ? 'q10')
    or not private.valid_survey(p_payload->'answers',p_payload->'q9',p_payload->'q10',p_submit) then raise exception 'Invalid survey. Complete required questions and check choices and text limits.'; end if;
  -- The same lock used by Canvas sync and mapping edits keeps the deadline stable through this save.
  perform private.canvas_lock(p_term);
  due:=private.survey_due(p_term);
  if due is null then raise exception 'Canvas M1 deadline unavailable. Please contact the teaching team.'; end if;
  if clock_timestamp()>=due then raise exception 'Submissions closed.'; end if;
  insert into public.m1_survey_responses(term_id,uni,answers,q9,q10,status,submitted_at)
    values(p_term,u,p_payload->'answers',p_payload->'q9',(p_payload->>'q10')::numeric,
      case when p_submit then 'submitted' else 'draft' end,case when p_submit then clock_timestamp() end)
    on conflict(term_id,uni) do update set answers=excluded.answers,q9=excluded.q9,q10=excluded.q10,
      status=excluded.status,submitted_at=excluded.submitted_at,updated_at=clock_timestamp() returning * into saved;
  return to_jsonb(saved);
end $$;
create function public.my_m1_survey(p_term text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if private.current_role()<>'student' or private.current_uni() is null or not private.can_read_term(p_term)
    or (private.preview_uni() is not null and p_term is distinct from private.current_term()) then raise exception 'Student access required for this term.'; end if;
  return jsonb_build_object('uni',private.current_uni(),
    'roster_name',coalesce((select name from public.roster where term_id=p_term and uni=private.current_uni()),''),
    'submission',(select to_jsonb(s) from public.m1_survey_responses s where term_id=p_term and uni=private.current_uni()),
    'due_at',private.survey_due(p_term),
    'read_only',private.preview_uni() is not null or (select status<>'active' from public.terms where id=p_term));
end $$;
create function public.m1_survey_class(p_term text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if private.current_role() not in ('instructor','grader') or not private.can_read_term(p_term) then raise exception 'Staff access required for this term.'; end if;
  return jsonb_build_object('students',coalesce((select jsonb_agg(jsonb_build_object('uni',r.uni,'name',r.name,'submission',to_jsonb(s)) order by r.name,r.uni)
    from private.term_roster(p_term) r left join public.m1_survey_responses s on s.term_id=p_term and s.uni=r.uni),'[]'::jsonb),
    'unrostered',coalesce((select jsonb_agg(jsonb_build_object('uni',s.uni,'name',s.uni,'submission',to_jsonb(s)) order by s.uni)
      from public.m1_survey_responses s where s.term_id=p_term and not exists(select 1 from private.term_roster(p_term) r where r.uni=s.uni)),'[]'::jsonb));
end $$;
revoke all on function private.valid_survey(jsonb,jsonb,jsonb,boolean),private.survey_due(text) from public,anon,authenticated;
revoke all on function public.save_m1_survey(text,jsonb,boolean),public.my_m1_survey(text),public.m1_survey_class(text) from public,anon,authenticated;
grant execute on function public.save_m1_survey(text,jsonb,boolean),public.my_m1_survey(text),public.m1_survey_class(text) to authenticated;
commit;
