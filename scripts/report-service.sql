-- Read-only. Bucket upper bounds are rounded up to the next 100 ms.
with recent as (
  select action,ok,bucket_ms,sum(observations) as n
  from public.hamster_action_timings
  where mobile and sample_day >= (now() at time zone 'Asia/Seoul')::date - 29
  group by action,ok,bucket_ms
), ranked as (
  select *,sum(n) over(partition by action,ok order by bucket_ms) as running,
    sum(n) over(partition by action,ok) as total from recent
), targets(action,goal_ms) as (values ('calendar_cold',2500),('postpone',1000))
select t.action,t.goal_ms,coalesce(sum(n) filter(where ok),0) as successful_samples,
  coalesce(sum(n) filter(where not ok),0) as unsuccessful_samples,
  min(bucket_ms) filter(where ok and running >= total * 0.75) as p75_ms_upper,
  case when coalesce(sum(n) filter(where ok),0) < 30 then 'insufficient_samples'
       when min(bucket_ms) filter(where ok and running >= total * 0.75) <= goal_ms then 'pass'
       else 'miss' end as timing_result
from targets t left join ranked using(action) group by t.action,t.goal_ms;

-- Includes indexes/TOAST. Photo bytes are already included in the relation size.
select relname, pg_total_relation_size(oid) as bytes_including_indexes
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' and left(relname,8)='hamster_'
order by 2 desc;

-- Operator access only. A retry leaves the previous failure available by date.
select scheduled_day,last_failure_target,last_failure_stage,last_failure_code,last_failure_at
from public.hamster_close_attempts where last_failure_at is not null order by scheduled_day desc limit 30;
select study_date,count(*) as delayed_submissions
from public.hamster_late_solve_reviews group by study_date order by study_date desc limit 30;

-- The preceding release did not have a durable close cursor. At cutover this
-- date is a read-only reconciliation item, including promotions around 04:00.
select first_date - 1 as verify_previous_worker_closed, first_date as first_new_worker_day
from public.hamster_finalization_cursor where singleton;
