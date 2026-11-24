-- Only an authorized production cutover activates the new worker.
-- Schema rollout alone leaves the running worker in control.
create table public.hamster_finalization_cursor (
  singleton boolean primary key default true check(singleton),
  first_date date not null,
  next_date date not null check(next_date >= first_date),
  revision bigint not null default 0,
  last_completed_at timestamptz
);
create table public.hamster_late_solve_reviews (
  submission_id uuid primary key references public.hamster_submissions(id) on delete cascade,
  study_date date not null,
  observed_at timestamptz not null default now()
);
alter table public.hamster_finalization_cursor enable row level security;
alter table public.hamster_late_solve_reviews enable row level security;
revoke all on public.hamster_finalization_cursor,public.hamster_late_solve_reviews from public,anon,authenticated;
grant select on public.hamster_finalization_cursor,public.hamster_late_solve_reviews to service_role;

create function public.hamster_track_late_solve() returns trigger
language plpgsql set search_path = '' as $$
declare
  day date := ((new.solved_at at time zone 'Asia/Seoul')-interval '4 hours')::date;
  cursor_day date;
begin
  if day >= ((clock_timestamp() at time zone 'Asia/Seoul')-interval '4 hours')::date then return null; end if;
  update public.hamster_finalization_cursor set revision=revision+1 where singleton returning next_date into cursor_day;
  if day < cursor_day then
    insert into public.hamster_late_solve_reviews(submission_id,study_date) values(new.id,day);
  end if;
  return null;
end $$;
create trigger hamster_late_github_solve after insert on public.hamster_submissions for each row
  when (new.source in ('github','backfill')) execute function public.hamster_track_late_solve();

create function public.hamster_next_finalization_day() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('day',next_date,'revision',revision::text)
    from public.hamster_finalization_cursor where singleton
$$;

create function public.hamster_activate_finalization(p_day date) returns jsonb
language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from public.hamster_finalization_cursor where singleton) then
    perform pg_advisory_xact_lock(hashtextextended('hamster.finalization.activation',0));
    insert into public.hamster_finalization_cursor(first_date,next_date) values(p_day,p_day)
      on conflict(singleton) do nothing;
  end if;
  return public.hamster_next_finalization_day();
end $$;

-- Old worker versions insert fines directly after their own reads. Once the
-- atomic worker owns a date, even a concurrent legacy deployment must defer.
create function public.hamster_guard_close_writer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('hamster.atomic_close',true)='on' then return new; end if;
  if not exists(select 1 from public.hamster_finalization_cursor where singleton) then
    perform pg_advisory_xact_lock(hashtextextended('hamster.finalization.activation',0));
  end if;
  if exists(select 1 from public.hamster_finalization_cursor where singleton and first_date<=new.study_date) then
    raise exception 'atomic_daily_close_required' using errcode='55000';
  end if;
  return new;
end $$;
create trigger hamster_guard_close_writer before insert on public.hamster_penalties for each row
  when (new.reason='missed') execute function public.hamster_guard_close_writer();

create function public.hamster_finish_finalization_day(p_day date,p_revision bigint,p_penalties jsonb) returns integer
language plpgsql set search_path = '' as $$
declare
  cursor_row public.hamster_finalization_cursor%rowtype;
  inserted integer;
  cutoff timestamptz := ((p_day+1)+time '04:00') at time zone 'Asia/Seoul';
begin
  select * into strict cursor_row from public.hamster_finalization_cursor where singleton for update;
  if p_day < cursor_row.next_date then return 0; end if;
  if p_day <> cursor_row.next_date or cursor_row.revision <> p_revision then raise serialization_failure; end if;
  if exists(
    select 1 from public.hamster_webhook_events e
    join public.hamster_repository_connections c on c.github_repository_id=e.repository_id and c.active
    where e.processed_at is null and e.event_name='push' and e.payload is not null
      and exists(select 1 from jsonb_array_elements(e.payload->'commits') as entries(item)
                 where item->>'timestamp' is null or (item->>'timestamp')::timestamptz < cutoff)
  ) then raise exception 'github_receipt_pending' using errcode='55000'; end if;

  perform set_config('hamster.atomic_close','on',true);
  insert into public.hamster_penalties(study_id,user_id,study_date,consecutive_misses,amount,reason)
    select study_id,user_id,p_day,consecutive_misses,amount,'missed'
    from jsonb_to_recordset(p_penalties) as items(study_id uuid,user_id uuid,consecutive_misses smallint,amount integer)
    on conflict(study_id,user_id,study_date) do nothing;
  get diagnostics inserted=row_count;
  perform set_config('hamster.atomic_close','off',true);
  update public.hamster_finalization_cursor set next_date=p_day+1,last_completed_at=clock_timestamp() where singleton;
  return inserted;
end $$;

revoke all on function public.hamster_track_late_solve(),public.hamster_guard_close_writer(),public.hamster_next_finalization_day(),public.hamster_activate_finalization(date),
  public.hamster_finish_finalization_day(date,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.hamster_next_finalization_day(),public.hamster_activate_finalization(date),public.hamster_finish_finalization_day(date,bigint,jsonb) to service_role;
grant select,insert,update on public.hamster_finalization_cursor to service_role;
grant insert on public.hamster_late_solve_reviews to service_role;
