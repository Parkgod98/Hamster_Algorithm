-- Read-only evidence for review-silver.mjs. Output excludes names and persistent IDs.
-- Baseline for the pre-release schema: the old application read the catalog difficulty.
with affected as (
  select distinct s.study_id, s.user_id from public.hamster_submissions s
  join public.hamster_problems p on p.id = s.problem_id
  where s.source in ('github','backfill') and p.platform = 'BOJ' and lower(trim(p.difficulty)) = 'silver'
), members as (
  select row_number() over(order by m.study_id,m.user_id) alias, m.study_id, m.user_id,
    ((m.joined_at at time zone 'Asia/Seoul') - interval '4 hours')::date joined
  from public.hamster_study_members m join affected using(study_id,user_id)
)
select jsonb_build_object(
  'alias', m.alias, 'asof', ((now() at time zone 'Asia/Seoul') - interval '4 hours')::date, 'joined', m.joined,
  'rules', (select jsonb_agg(jsonb_build_array(v.effective_from, v.max_presolve_days, v.max_consecutive_postpone,
    v.rule_config - 'goals', (v.rule_config->'goals') - 'englishRule' - 'instructions'))
    from public.hamster_study_rule_versions v where v.study_id=m.study_id),
  'subs', (select jsonb_agg(jsonb_build_array(s.solved_at,s.created_at,p.platform,p.difficulty,s.source))
    from public.hamster_submissions s join public.hamster_problems p on p.id=s.problem_id
    where s.study_id=m.study_id and s.user_id=m.user_id),
  'goals', (select jsonb_agg(jsonb_build_array(g.study_date,g.created_at,g.goal))
    from public.hamster_goal_completions g where g.study_id=m.study_id and g.user_id=m.user_id),
  'post', (select jsonb_agg(jsonb_build_array(q.study_date,q.requested_at))
    from public.hamster_postponements q where q.study_id=m.study_id and q.user_id=m.user_id),
  'penalties', (select jsonb_agg(jsonb_build_array(f.study_date,f.amount))
    from public.hamster_penalties f where f.study_id=m.study_id and f.user_id=m.user_id)
) as review from members m order by m.alias;
