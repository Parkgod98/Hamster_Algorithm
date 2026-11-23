-- Persist a retryable receipt separately from the atomic submission transaction.
alter table public.hamster_webhook_events add column payload jsonb;
alter table public.hamster_webhook_events add column last_attempt_at timestamptz;
create index hamster_pending_webhook_receipts on public.hamster_webhook_events(last_attempt_at nulls first,received_at)
  where processed_at is null and payload is not null;

-- The production backfill explicitly targets the existing source_event_id unique
-- constraint. Keep its canonical row and use stable IDs for additional studies.
create unique index hamster_submission_study_github_event
  on public.hamster_submissions(study_id, split_part(source_event_id,':hamster-study:',1))
  where source in ('github','backfill');

create function public.hamster_algorithm_studies_for_solve(p_user uuid,p_solved timestamptz)
returns setof uuid language plpgsql stable set search_path = '' as $$
declare
  membership record;
  day date := ((p_solved at time zone 'Asia/Seoul')-interval '4 hours')::date;
begin
  for membership in
    select m.study_id,r.rule_config from public.hamster_study_members m
    left join lateral (select v.rule_config from public.hamster_study_rule_versions v
      where v.study_id=m.study_id and v.effective_from<=day order by v.effective_from desc limit 1) r on true
    where m.user_id=p_user and ((m.joined_at at time zone 'Asia/Seoul')-interval '4 hours')::date<=day order by m.study_id
  loop
    if membership.rule_config is null then raise exception 'Missing rule history for study % on %',membership.study_id,day; end if;
    if coalesce(membership.rule_config #> '{goals,allowed}', '["algorithm"]'::jsonb) ? 'algorithm' then
      return next membership.study_id;
    end if;
  end loop;
end
$$;

create function public.hamster_link_github_repositories(p_user uuid,p_study uuid,p_installation bigint,p_owner text,p_repositories jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  repo jsonb;
begin
  perform 1 from public.hamster_study_members where study_id=p_study and user_id=p_user for share;
  if not found then raise insufficient_privilege; end if;
  insert into public.hamster_github_installations(installation_id,user_id,account_login)
    values(p_installation,p_user,p_owner) on conflict(installation_id) do update set account_login=excluded.account_login
    where hamster_github_installations.user_id=p_user;
  if not found then raise insufficient_privilege; end if;
  update public.hamster_repository_connections set active=false where installation_id=p_installation and user_id=p_user;
  for repo in select value from jsonb_array_elements(p_repositories) order by (value->>'id')::bigint
  loop
    insert into public.hamster_repository_connections(user_id,study_id,installation_id,github_repository_id,full_name)
      values(p_user,p_study,p_installation,(repo->>'id')::bigint,repo->>'full_name')
    on conflict(github_repository_id) do update set
      installation_id=excluded.installation_id,active=true,full_name=excluded.full_name
      where hamster_repository_connections.user_id=p_user;
    if not found then raise insufficient_privilege; end if;
  end loop;
end
$$;

create function public.hamster_record_github_solutions(p_connection uuid,p_source text,p_submissions jsonb,p_delivery text default null)
returns table(target_study uuid, solver uuid, event_id text)
language plpgsql set search_path = '' as $$
declare
  item jsonb;
  problem uuid;
  connection_row public.hamster_repository_connections%rowtype;
  solved timestamptz;
begin
  if p_source not in ('github','backfill') then raise exception 'Invalid submission source'; end if;
  if p_delivery is not null then
    perform 1 from public.hamster_webhook_events where delivery_id=p_delivery and processed_at is null for update;
    if not found then return; end if;
  end if;
  select * into strict connection_row from public.hamster_repository_connections where id=p_connection and active for share;
  perform set_config('hamster.github_batch','on',true);
  for item in select value from jsonb_array_elements(p_submissions) order by value->>'platform',value->>'externalId',value->>'sourceEventId'
  loop
    solved := (item->>'solvedAt')::timestamptz;
    insert into public.hamster_problems(platform,external_id,title,difficulty)
      values(item->>'platform',item->>'externalId',item->>'title',item->>'difficulty')
      on conflict(platform,external_id) do update set title=excluded.title,difficulty=excluded.difficulty returning id into problem;
    return query
      insert into public.hamster_submissions(user_id,study_id,repository_connection_id,problem_id,solved_at,source,source_event_id)
      select connection_row.user_id,target,p_connection,problem,solved,p_source,
        case when target=coalesce((select s.study_id from public.hamster_submissions s where s.source_event_id=item->>'sourceEventId'),connection_row.study_id)
          then item->>'sourceEventId' else (item->>'sourceEventId')||':hamster-study:'||target::text end
      from public.hamster_algorithm_studies_for_solve(connection_row.user_id,solved) as target
      on conflict do nothing
      returning study_id,user_id,(item->>'sourceEventId');
  end loop;
  if p_delivery is not null then
    update public.hamster_webhook_events set processed_at=now(),payload=null where delivery_id=p_delivery;
  end if;
end
$$;

-- Existing GitHub solves retain their identifiers, and existing memberships
-- receive missing credits only for days they were already participating.
insert into public.hamster_submissions(user_id,study_id,repository_connection_id,problem_id,solved_at,source,source_event_id)
select s.user_id,target,s.repository_connection_id,s.problem_id,s.solved_at,s.source,
  s.source_event_id||':hamster-study:'||target::text
from public.hamster_submissions s
cross join lateral public.hamster_algorithm_studies_for_solve(s.user_id,s.solved_at) as target
where s.source in ('github','backfill') and target<>s.study_id
on conflict do nothing;

-- The old deployment can still receive pushes during rollout. Mirror its
-- original write in the same transaction; scoped copies never recurse.
create function public.hamster_mirror_legacy_github_solve() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('hamster.github_batch',true)='on' then return new; end if;
  insert into public.hamster_submissions(user_id,study_id,repository_connection_id,problem_id,solved_at,source,source_event_id)
    select new.user_id,target,new.repository_connection_id,new.problem_id,new.solved_at,new.source,
      new.source_event_id||':hamster-study:'||target::text
    from public.hamster_algorithm_studies_for_solve(new.user_id,new.solved_at) as target
    where target<>new.study_id on conflict do nothing;
  return new;
end
$$;
create trigger hamster_mirror_legacy_github after insert on public.hamster_submissions
for each row when (new.source in ('github','backfill') and position(':hamster-study:' in new.source_event_id)=0)
execute function public.hamster_mirror_legacy_github_solve();

revoke all on function public.hamster_algorithm_studies_for_solve(uuid,timestamptz),public.hamster_link_github_repositories(uuid,uuid,bigint,text,jsonb),
 public.hamster_record_github_solutions(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.hamster_algorithm_studies_for_solve(uuid,timestamptz),public.hamster_link_github_repositories(uuid,uuid,bigint,text,jsonb),
 public.hamster_record_github_solutions(uuid,text,jsonb,text) to service_role;
