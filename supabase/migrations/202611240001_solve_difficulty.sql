-- Existing solves keep exactly the difficulty used immediately before rollout.
-- This migration neither regrades legacy Silver rows nor writes any penalties.
alter table public.hamster_submissions add column earned_difficulty text;
create function public.hamster_capture_solve_difficulty() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.earned_difficulty is null then
    select p.difficulty into strict new.earned_difficulty
    from public.hamster_problems p where p.id = new.problem_id;
  end if;
  return new;
end $$;
create trigger hamster_capture_solve_difficulty before insert on public.hamster_submissions
for each row execute function public.hamster_capture_solve_difficulty();

-- No user-visible value changes during this one-time copy. Hold the write lock
-- while suppressing only the existing sync trigger to avoid waking every viewer.
do $$
begin
  alter table public.hamster_submissions disable trigger hamster_sync_submission;
  update public.hamster_submissions s set earned_difficulty = p.difficulty
  from public.hamster_problems p where s.problem_id = p.id and s.earned_difficulty is null;
  alter table public.hamster_submissions enable trigger hamster_sync_submission;
end $$;
alter table public.hamster_submissions alter column earned_difficulty set not null;

-- PostgREST computed relationship for older dashboard/detail/statistics/cron
-- bundles that select hamster_submissions(...,hamster_problems(difficulty)).
create function public.hamster_problems(public.hamster_submissions)
returns setof public.hamster_problems rows 1 stable language sql as $$
  select p.id,p.platform,p.external_id,p.title,$1.earned_difficulty,p.created_at
  from public.hamster_problems p where p.id=$1.problem_id
$$;
revoke all on function public.hamster_problems(public.hamster_submissions) from public,anon;
grant execute on function public.hamster_problems(public.hamster_submissions) to authenticated,service_role;

-- A replay must not rewrite the catalog difficulty used by a rolling-back client.
-- The signed commit's rank belongs to the new submission, including its study copies.
create or replace function public.hamster_record_github_solutions(p_connection uuid,p_source text,p_submissions jsonb,p_delivery text default null)
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
      on conflict(platform,external_id) do update set title=excluded.title returning id into problem;
    return query
      insert into public.hamster_submissions(user_id,study_id,repository_connection_id,problem_id,earned_difficulty,solved_at,source,source_event_id)
      select connection_row.user_id,target,p_connection,problem,item->>'difficulty',solved,p_source,
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

create or replace view public.hamster_daily_solution_counts with (security_invoker = true) as
select s.study_id, s.user_id,
       ((s.solved_at at time zone 'Asia/Seoul') - interval '4 hours')::date as study_date,
       p.platform, s.earned_difficulty as difficulty, count(*)::integer as solves, max(s.solved_at) as solved_through
from public.hamster_submissions s
join public.hamster_problems p on p.id = s.problem_id
left join lateral (
  select g.created_at from public.hamster_goal_completions g
  where g.study_id = s.study_id and g.user_id = s.user_id and g.created_at <= s.solved_at
    and g.created_at >= (date_trunc('day', (s.solved_at at time zone 'Asia/Seoul') - interval '4 hours') + interval '4 hours') at time zone 'Asia/Seoul'
    and g.study_date <= ((s.solved_at at time zone 'Asia/Seoul') - interval '4 hours')::date
  order by g.created_at desc limit 1
) boundary on true
group by 1, 2, 3, 4, 5, boundary.created_at;

revoke all on function public.hamster_capture_solve_difficulty() from public, anon, authenticated;
notify pgrst,'reload schema';
