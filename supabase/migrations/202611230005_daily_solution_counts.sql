-- Only check-ins that take effect today can split a group; a future-dated
-- certification takes effect on its chosen day. Algorithm-only groups are
-- still one row per member, date and difficulty.
create index hamster_goal_checkin_time on public.hamster_goal_completions(study_id,user_id,created_at);
create view public.hamster_daily_solution_counts with (security_invoker = true) as
select s.study_id, s.user_id,
       ((s.solved_at at time zone 'Asia/Seoul') - interval '4 hours')::date as study_date,
       p.platform, p.difficulty, count(*)::integer as solves, max(s.solved_at) as solved_through
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

revoke all on public.hamster_daily_solution_counts from public, anon, authenticated;
grant select on public.hamster_daily_solution_counts to service_role;
