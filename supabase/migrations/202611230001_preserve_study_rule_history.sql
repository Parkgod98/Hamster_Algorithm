-- The creation row and its first rules must commit together, including custom
-- settings explicitly supplied when creating a study.
create function public.hamster_record_initial_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.hamster_study_rule_versions
    (study_id, effective_from, rule_config, postpone_deadline_hour, postpone_deadline_minute,
     max_consecutive_postpone, max_presolve_days, changed_by, created_at)
  values
    (new.id, ((new.created_at at time zone 'Asia/Seoul') - interval '4 hours')::date,
     new.rule_config, new.postpone_deadline_hour, new.postpone_deadline_minute,
     new.max_consecutive_postpone, new.max_presolve_days, new.created_by, new.created_at);
  return new;
end
$$;

create trigger hamster_initial_rules after insert on public.hamster_studies
for each row execute function public.hamster_record_initial_rules();

-- Keep the original saved values and author when a pending version is edited
-- again before it takes effect. Daily evaluations only need the active row.
create table public.hamster_superseded_rule_versions (
  id bigint generated always as identity primary key,
  study_id uuid not null references public.hamster_studies(id) on delete cascade,
  effective_from date not null,
  snapshot jsonb not null
);
alter table public.hamster_superseded_rule_versions enable row level security;
create function public.hamster_archive_superseded_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.hamster_superseded_rule_versions(study_id, effective_from, snapshot)
    values (old.study_id, old.effective_from, to_jsonb(old));
  return new;
end
$$;
create trigger hamster_archive_rules before update on public.hamster_study_rule_versions
for each row execute function public.hamster_archive_superseded_rules();

-- Repository history: the legacy creation API supplied only name and creator.
-- The schema defaults below are the ones used by that API, frozen here rather
-- than taken from today's settings or a future version of the defaults.
do $$
declare
  initial_config constant jsonb := '{
    "bojBronzeCount":3,"bojSilverCount":2,"bojGoldCount":1,
    "programmersLowCount":3,"programmersHighCount":1,
    "sweaLowCount":2,"sweaHighCount":1,"codetreeSamsungCount":1,
    "penalties":{"1":10000,"2":25000,"3":50000}
  }';
  study public.hamster_studies%rowtype;
  latest public.hamster_study_rule_versions%rowtype;
begin
  for study in select s.* from public.hamster_studies s
    where not exists (
      select 1 from public.hamster_study_rule_versions v where v.study_id = s.id
        and v.effective_from = ((s.created_at at time zone 'Asia/Seoul') - interval '4 hours')::date
    ) order by s.id for update
  loop
    select * into latest from public.hamster_study_rule_versions
      where study_id = study.id order by effective_from desc limit 1;
    -- A settings write in the old API could succeed before its history write
    -- failed. Preserve the evidence and identify the actual conflicting study.
    if row(study.rule_config, study.postpone_deadline_hour, study.postpone_deadline_minute,
           study.max_consecutive_postpone, study.max_presolve_days)
       is distinct from row(coalesce(latest.rule_config, initial_config),
           coalesce(latest.postpone_deadline_hour, 23), coalesce(latest.postpone_deadline_minute, 59),
           coalesce(latest.max_consecutive_postpone, 2), coalesce(latest.max_presolve_days, 2)) then
      raise exception 'Cannot reconstruct rule history for study %: stored settings disagree with known history', study.id;
    end if;
    insert into public.hamster_study_rule_versions
      (study_id, effective_from, rule_config, postpone_deadline_hour, postpone_deadline_minute,
       max_consecutive_postpone, max_presolve_days, changed_by, created_at)
    values (study.id, ((study.created_at at time zone 'Asia/Seoul') - interval '4 hours')::date,
            initial_config, 23, 59, 2, 2, study.created_by, study.created_at);
  end loop;
end
$$;

-- The API supplies the verified user, never a caller-supplied actor. Restrict
-- this RPC to the server and lock membership until the transaction finishes.
create function public.hamster_schedule_study_rules(
  p_study_id uuid, p_actor uuid, p_config jsonb, p_hour integer, p_minute integer,
  p_max_postpone integer, p_max_presolve integer
) returns date language plpgsql set search_path = '' as $$
declare
  starts_on date;
begin
  perform 1 from public.hamster_study_members
    where study_id = p_study_id and user_id = p_actor and role = 'admin' for share;
  if not found then
    raise insufficient_privilege using message = 'Study administrator required';
  end if;
  perform 1 from public.hamster_studies where id = p_study_id for update;
  starts_on := ((clock_timestamp() at time zone 'Asia/Seoul') - interval '4 hours')::date + 1;
  insert into public.hamster_study_rule_versions
    (study_id, effective_from, rule_config, postpone_deadline_hour, postpone_deadline_minute,
     max_consecutive_postpone, max_presolve_days, changed_by)
  values (p_study_id, starts_on, p_config, p_hour, p_minute, p_max_postpone, p_max_presolve, p_actor)
  on conflict (study_id, effective_from) do update set
    rule_config = excluded.rule_config, postpone_deadline_hour = excluded.postpone_deadline_hour,
    postpone_deadline_minute = excluded.postpone_deadline_minute,
    max_consecutive_postpone = excluded.max_consecutive_postpone, max_presolve_days = excluded.max_presolve_days,
    changed_by = excluded.changed_by, created_at = clock_timestamp();
  update public.hamster_studies set rule_config = p_config, postpone_deadline_hour = p_hour,
    postpone_deadline_minute = p_minute, max_consecutive_postpone = p_max_postpone,
    max_presolve_days = p_max_presolve where id = p_study_id;
  return starts_on;
end
$$;
revoke all on function public.hamster_schedule_study_rules(uuid,uuid,jsonb,integer,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.hamster_schedule_study_rules(uuid,uuid,jsonb,integer,integer,integer,integer)
  to service_role;
