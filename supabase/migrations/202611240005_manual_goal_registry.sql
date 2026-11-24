-- Only registered manual goals can be stored, including through older clients.
create table public.hamster_manual_goals (
  goal text primary key check (goal ~ '^[a-z][a-z0-9_]{0,39}$' and goal <> 'algorithm')
);
alter table public.hamster_manual_goals enable row level security;
revoke all on public.hamster_manual_goals from public, anon, authenticated;
grant select on public.hamster_manual_goals to service_role;
insert into public.hamster_manual_goals (goal) values ('english'), ('reading');

alter table public.hamster_goal_completions
  drop constraint hamster_goal_completions_goal_check,
  add constraint hamster_goal_completions_manual_goal_fkey foreign key (goal)
    references public.hamster_manual_goals(goal);

create or replace function public.hamster_record_goal(
  p_study uuid, p_user uuid, p_day date, p_goal text, p_type text default null, p_photo text default null
) returns uuid language plpgsql set search_path = '' as $$
declare
  joined timestamptz;
  today date;
  cutoff_time timestamptz;
  rules public.hamster_study_rule_versions%rowtype;
  saved uuid;
begin
  perform 1 from public.hamster_studies where id = p_study for share;
  select joined_at into joined from public.hamster_study_members
    where study_id = p_study and user_id = p_user for share;
  if not found then raise insufficient_privilege using message = 'membership'; end if;
  cutoff_time := clock_timestamp();
  today := ((cutoff_time at time zone 'Asia/Seoul') - interval '4 hours')::date;
  if p_day is null or p_day < ((joined at time zone 'Asia/Seoul') - interval '4 hours')::date then
    raise exception using errcode = '22023', message = 'before_membership';
  end if;
  select * into rules from public.hamster_study_rule_versions
    where study_id = p_study and effective_from <= p_day order by effective_from desc limit 1;
  if not found then raise exception 'Missing effective study rules'; end if;
  if p_goal is null or not exists (select 1 from public.hamster_manual_goals where goal = p_goal)
      or not coalesce((rules.rule_config #> '{goals,allowed}') ? p_goal, false) then
    raise exception using errcode = '22023', message = 'goal_unavailable';
  end if;
  if p_day > today + rules.max_presolve_days then
    raise exception using errcode = '22023', message = 'presolve_limit';
  end if;
  if (p_type is null) <> (p_photo is null) or p_type not in ('image/png','image/jpeg','image/webp')
     or length(p_photo) > 2796204 then
    raise exception using errcode = '22023', message = 'photo_invalid';
  end if;
  insert into public.hamster_goal_completions as previous (study_id,user_id,study_date,goal,created_at,photo_type)
    values (p_study,p_user,p_day,p_goal,cutoff_time,p_type)
    on conflict (study_id,user_id,study_date,goal) do update
    set created_at=excluded.created_at, photo_type=coalesce(excluded.photo_type,previous.photo_type)
    -- A pending rule edit can shorten the window for a future date. The
    -- member may certify again once that date comes back into range.
    where previous.study_date - ((previous.created_at at time zone 'Asia/Seoul') - interval '4 hours')::date > rules.max_presolve_days
    returning id into saved;
  if saved is null then
    select id into strict saved from public.hamster_goal_completions
      where study_id=p_study and user_id=p_user and study_date=p_day and goal=p_goal;
  elsif p_photo is not null then
    insert into public.hamster_goal_photos (completion_id,image) values (saved,decode(p_photo,'base64'))
      on conflict (completion_id) do update set image=excluded.image;
  end if;
  return saved;
end
$$;
