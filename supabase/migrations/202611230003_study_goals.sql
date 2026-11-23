create table public.hamster_goal_completions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null,
  user_id uuid not null,
  study_date date not null,
  goal text not null check (goal in ('english', 'reading')),
  created_at timestamptz not null default clock_timestamp(),
  photo_type text check (photo_type in ('image/jpeg', 'image/png', 'image/webp')),
  foreign key (study_id, user_id) references public.hamster_study_members(study_id, user_id) on delete cascade,
  unique(study_id, user_id, study_date, goal)
);
create index hamster_goal_completions_date on public.hamster_goal_completions(study_id, study_date, user_id);

-- Calendar progress only reads completion metadata. Image bytes are read for a
-- particular submission after the server verifies the viewer's membership.
create table public.hamster_goal_photos (
  completion_id uuid primary key references public.hamster_goal_completions(id) on delete cascade,
  image bytea not null check (octet_length(image) between 1 and 2097152)
);
alter table public.hamster_goal_completions enable row level security;
alter table public.hamster_goal_photos enable row level security;
revoke all on public.hamster_goal_completions, public.hamster_goal_photos from anon, authenticated;
grant select, insert, update on public.hamster_goal_completions, public.hamster_goal_photos to service_role;

create function public.hamster_record_goal(
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
  if p_goal is null or p_goal not in ('english','reading')
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
revoke all on function public.hamster_record_goal(uuid,uuid,date,text,text,text) from public, anon, authenticated;
grant execute on function public.hamster_record_goal(uuid,uuid,date,text,text,text) to service_role;
