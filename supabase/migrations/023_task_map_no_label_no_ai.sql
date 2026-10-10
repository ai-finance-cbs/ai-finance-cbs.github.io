-- M2 simplification (Simon, 2026-10-09): the look-ahead task no longer carries a label, and the
-- AI-use disclosure is gone. Submission still requires 8 complete tasks and a complete look-ahead
-- (name, description, reasoning). Only the submit-time requirements change; field limits stay.
begin;
create or replace function private.valid_task_map(j jsonb, tasks jsonb, ahead jsonb, ai text, submitted boolean)
returns boolean language plpgsql immutable set search_path='' as $$
declare part jsonb; field text; cap integer; complete integer:=0;
begin
  if jsonb_typeof(j) is distinct from 'object' or jsonb_typeof(tasks) is distinct from 'array'
    or jsonb_typeof(ahead) is distinct from 'object' or ai is null or length(ai)>600 then return false; end if;
  if jsonb_array_length(tasks)>12 or exists(select 1 from jsonb_object_keys(j) k where k not in ('firm_type','role','duration')) then return false; end if;
  foreach field in array array['firm_type','role','duration'] loop
    if jsonb_typeof(j->field) is distinct from 'string' or length(j->>field)>120 then return false; end if;
  end loop;
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
  if exists(select 1 from jsonb_array_elements(tasks) t where t ? 'reasoning') then return false; end if;
  if jsonb_typeof(ahead->'reasoning') is distinct from 'string' then return false; end if;
  if submitted then
    select count(*) into complete from jsonb_array_elements(tasks) t where
      t->>'name' ~ '[^[:space:]]' and t->>'description' ~ '[^[:space:]]' and t->>'label' in ('Process','Predict','Persuade','Own');
    if complete<8 or not coalesce(ahead->>'name' ~ '[^[:space:]]',false)
      or not coalesce(ahead->>'description' ~ '[^[:space:]]',false)
      or not coalesce(ahead->>'reasoning' ~ '[^[:space:]]',false) then return false; end if;
  end if;
  return true;
end $$;
revoke all on function private.valid_task_map(jsonb,jsonb,jsonb,text,boolean) from public,anon,authenticated;
commit;
