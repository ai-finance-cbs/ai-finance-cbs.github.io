-- M1 setup is required before the survey: no "could not finish setup" choice and no S4 problems field.
begin;
create or replace function private.valid_survey(a jsonb, q9 jsonb, q10 jsonb, submitted boolean)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text; cap text; g jsonb; choice jsonb;
begin
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(q9) is distinct from 'array' then return false; end if;
  if exists(select 1 from jsonb_object_keys(a) f where f not in
    ('full_name','preferred_name','job','career_examples','other_tool','ai_use','wish','worries','other_info','setup_version','setup_haiku','program','sector','setup_assistant','ai_frequency','experience')) then return false; end if;
  for k,cap in select * from jsonb_each_text('{"full_name":120,"preferred_name":120,"job":3000,"career_examples":500,"other_tool":120,"ai_use":1500,"wish":600,"worries":1000,"other_info":2000,"setup_version":500,"setup_haiku":2000}'::jsonb) loop
    if jsonb_typeof(a->k) is distinct from 'string' or length(a->>k)>cap::integer then return false; end if;
    if submitted and k in ('full_name','preferred_name','job','career_examples','ai_use','wish','setup_version','setup_haiku')
      and not (a->>k ~ '[^[:space:]]') then return false; end if;
  end loop;
  if jsonb_typeof(a->'program') is distinct from 'string' or a->>'program' not in ('','MBA 2027','MBA 2028','EMBA','MS','PhD','Other')
    or jsonb_typeof(a->'sector') is distinct from 'string' or a->>'sector' not in ('','Investment banking','Sales and trading','Asset management / hedge funds','Private equity / VC / private credit','Corporate finance','Consulting','Fintech / tech','Entrepreneurship','Other')
    or jsonb_typeof(a->'setup_assistant') is distinct from 'string' or a->>'setup_assistant' not in ('','Claude Code','Codex') then return false; end if;
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
commit;
