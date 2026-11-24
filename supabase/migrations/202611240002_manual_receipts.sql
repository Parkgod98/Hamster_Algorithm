create table public.hamster_manual_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  study_id uuid not null references public.hamster_studies(id) on delete cascade,
  study_date date not null,
  platform text not null,
  difficulty text not null,
  problem_count smallint not null check (problem_count between 1 and 20),
  primary key(user_id, request_id)
);
alter table public.hamster_manual_receipts enable row level security;
revoke all on public.hamster_manual_receipts from public, anon, authenticated;
grant select,insert on public.hamster_manual_receipts to service_role;

create function public.hamster_record_manual_batch(
  p_user uuid, p_study uuid, p_request uuid, p_day date, p_platform text,
  p_difficulty text, p_count integer, p_external_id text
) returns boolean language plpgsql set search_path = '' as $$
declare
  previous public.hamster_manual_receipts%rowtype;
  joined timestamp with time zone;
  allowed jsonb;
  problem uuid;
begin
  select m.joined_at into strict joined from public.hamster_study_members m
    where m.study_id=p_study and m.user_id=p_user for share;
  if p_day < ((joined at time zone 'Asia/Seoul')-interval '4 hours')::date
    or p_day > ((now() at time zone 'Asia/Seoul')-interval '4 hours')::date then
    raise invalid_parameter_value;
  end if;
  insert into public.hamster_manual_receipts values(p_user,p_request,p_study,p_day,p_platform,p_difficulty,p_count)
    on conflict(user_id,request_id) do nothing;
  if not found then
    select * into strict previous from public.hamster_manual_receipts where user_id=p_user and request_id=p_request;
    if (previous.study_id,previous.study_date,previous.platform,previous.difficulty,previous.problem_count)
      is distinct from (p_study,p_day,p_platform,p_difficulty,p_count) then raise invalid_parameter_value; end if;
    return false;
  end if;
  select coalesce(r.rule_config->'goals'->'allowed','["algorithm"]'::jsonb) into strict allowed
    from public.hamster_study_rule_versions r where r.study_id=p_study and r.effective_from<=p_day
    order by r.effective_from desc limit 1;
  if not (allowed ? 'algorithm') then raise invalid_parameter_value; end if;
  insert into public.hamster_problems(platform,external_id,title,difficulty)
    values(p_platform,p_external_id,p_difficulty||' 수동 인증',p_difficulty)
    on conflict(platform,external_id) do update set title=excluded.title returning id into problem;
  insert into public.hamster_submissions(user_id,study_id,problem_id,earned_difficulty,solved_at,source,source_event_id)
    select p_user,p_study,problem,p_difficulty,(p_day+time '12:00') at time zone 'Asia/Seoul','manual',
      'manual:'||p_user||':'||p_request||':'||n from generate_series(1,p_count) as seq(n);
  return true;
end $$;
revoke all on function public.hamster_record_manual_batch(uuid,uuid,uuid,date,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.hamster_record_manual_batch(uuid,uuid,uuid,date,text,text,integer,text) to service_role;
