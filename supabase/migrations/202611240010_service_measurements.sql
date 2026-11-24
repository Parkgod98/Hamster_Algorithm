create table public.hamster_action_timings (
  sample_day date not null,
  action text not null check(action in ('calendar_cold','postpone')),
  mobile boolean not null,
  ok boolean not null,
  bucket_ms integer not null check(bucket_ms between 0 and 60000 and bucket_ms % 100 = 0),
  observations bigint not null default 1 check(observations > 0),
  primary key(sample_day,action,mobile,ok,bucket_ms)
);
alter table public.hamster_action_timings enable row level security;
revoke all on public.hamster_action_timings from public,anon,authenticated;
grant select,insert,update,delete on public.hamster_action_timings to service_role;

create function public.hamster_record_action_timing(p_action text,p_mobile boolean,p_ok boolean,p_bucket integer)
returns void language plpgsql set search_path = '' as $$
declare today date := (current_timestamp at time zone 'Asia/Seoul')::date;
begin
  insert into public.hamster_action_timings(sample_day,action,mobile,ok,bucket_ms)
  values(today,p_action,p_mobile,p_ok,p_bucket)
  on conflict(sample_day,action,mobile,ok,bucket_ms) do update
    set observations = public.hamster_action_timings.observations + 1;
  delete from public.hamster_action_timings where sample_day < today - 34;
end $$;
revoke all on function public.hamster_record_action_timing(text,boolean,boolean,integer) from public,anon,authenticated;
grant execute on function public.hamster_record_action_timing(text,boolean,boolean,integer) to service_role;

create table public.hamster_close_attempts (
  scheduled_day date primary key,
  target_day date not null,
  stage text not null check(stage in ('started','read','write')),
  error_code text check (error_code in ('55000','40001','finalization-failed')),
  observed_at timestamptz not null,
  last_failure_at timestamptz,
  last_failure_code text,
  last_failure_stage text,
  last_failure_target date
);
alter table public.hamster_close_attempts enable row level security;
revoke all on public.hamster_close_attempts from public,anon,authenticated;
grant select,insert,update on public.hamster_close_attempts to service_role;
