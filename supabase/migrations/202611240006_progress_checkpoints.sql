-- Derived state only. Existing sessions, submissions, penalties and rules stay authoritative.
create table public.hamster_progress_checkpoints (
  study_id uuid not null, user_id uuid not null, through_day date not null, state jsonb not null,
  primary key (study_id,user_id,through_day),
  foreign key (study_id,user_id) references public.hamster_study_members(study_id,user_id) on delete cascade
);
alter table public.hamster_progress_checkpoints enable row level security;
revoke all on public.hamster_progress_checkpoints from public, anon, authenticated;
grant select,insert on public.hamster_progress_checkpoints to service_role;
grant select,insert,update on public.hamster_sync_heads to service_role;

-- The journal head is advanced under a row lock at commit. Invalidating within
-- that same transaction lets a reader publish only against its original revision.
create function public.hamster_expire_progress_checkpoints() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  study uuid;
  previous bigint := case when tg_op='INSERT' then 0 else old.revision end;
  hint jsonb;
begin
  if left(new.scope,2)<>'s:' or new.revision=previous then return null; end if;
  study := substr(new.scope,3)::uuid;
  if not exists (select 1 from public.hamster_progress_checkpoints where study_id=study) then return null; end if;
  if new.revision-previous > jsonb_array_length(new.history) then
    delete from public.hamster_progress_checkpoints where study_id=study;
    return null;
  end if;
  for hint in select value from jsonb_array_elements(new.history) where (value->>'rev')::bigint>previous
  loop
    if hint->>'kind' in ('submission','goal','postponement','member','rules') then
      delete from public.hamster_progress_checkpoints
        where study_id=study and (hint->>'userId' is null or user_id=(hint->>'userId')::uuid)
          and (hint->>'date' is null or through_day >= (hint->>'date')::date);
    end if;
  end loop;
  return null;
end $$;
create trigger hamster_checkpoint_expiry after insert or update on public.hamster_sync_heads
  for each row execute function public.hamster_expire_progress_checkpoints();

create function public.hamster_read_progress_checkpoints(p_study uuid,p_member uuid,p_boundary date)
returns jsonb language sql stable set search_path='' as $$
  with members as materialized (
    select m.user_id,m.joined_at,c.state,c.through_day from public.hamster_study_members m
    left join lateral (select cp.state,cp.through_day from public.hamster_progress_checkpoints cp
      where cp.study_id=m.study_id and cp.user_id=m.user_id and cp.through_day<=p_boundary
      order by cp.through_day desc limit 1) c on true
    where m.study_id=p_study and (p_member is null or m.user_id=p_member)
  )
  select jsonb_build_object('revision',coalesce((select revision::text from public.hamster_sync_heads
    where scope='s:'||p_study),'0'),
    'floor',least(p_boundary+1,min(coalesce(through_day+1,((joined_at at time zone 'Asia/Seoul')-interval '4 hours')::date))),
    'members',coalesce(jsonb_object_agg(user_id,state) filter(where state is not null),'{}'::jsonb))
  from members
$$;

create index hamster_submissions_study_day_member on public.hamster_submissions
  (study_id,(((solved_at at time zone 'Asia/Seoul')-interval '4 hours')::date),user_id);
create index hamster_rules_carry_limit on public.hamster_study_rule_versions
  (study_id,max_presolve_days desc,effective_from);

create function public.hamster_save_progress_checkpoints(p_study uuid,p_revision bigint,p_states jsonb)
returns boolean language plpgsql set search_path='' as $$
declare current_revision bigint;
begin
  insert into public.hamster_sync_heads(scope,revision,history) values('s:'||p_study,0,'[]') on conflict do nothing;
  select revision into strict current_revision from public.hamster_sync_heads where scope='s:'||p_study for update;
  if current_revision<>p_revision then return false; end if;
  insert into public.hamster_progress_checkpoints(study_id,user_id,through_day,state)
    select p_study,m.user_id,(j.value->>'through')::date,j.value
    from jsonb_each(p_states) j join public.hamster_study_members m on m.study_id=p_study and m.user_id=j.key::uuid
    where (j.value->>'version')='1' and (j.value->>'through')::date < ((now() at time zone 'Asia/Seoul')-interval '4 hours')::date
    on conflict do nothing;
  return true;
end $$;

create function public.hamster_guarded_postponement(p_study uuid,p_user uuid,p_day date,p_revision bigint,p_deadline timestamptz)
returns text language plpgsql set search_path='' as $$
declare revision_at_write bigint; hints jsonb;
begin
  if not exists(select 1 from public.hamster_study_members where study_id=p_study and user_id=p_user for share)
    then return 'changed'; end if;
  insert into public.hamster_sync_heads(scope,revision,history) values('s:'||p_study,0,'[]') on conflict do nothing;
  select revision,history into strict revision_at_write,hints from public.hamster_sync_heads where scope='s:'||p_study for update;
  if exists(select 1 from public.hamster_postponements where study_id=p_study and user_id=p_user and study_date=p_day)
    then return 'duplicate'; end if;
  -- Other members may save at the same time. Only their own progress changes
  -- are independent. Unknown events and incomplete history require a fresh read.
  if p_revision is null or revision_at_write<p_revision or revision_at_write-p_revision>jsonb_array_length(hints)
    or exists(select 1 from jsonb_array_elements(hints) h where (h->>'rev')::bigint>p_revision
      and not coalesce(h->>'kind' in ('submission','goal','postponement','member') and h->>'userId'<>p_user::text,false))
    or p_deadline is null or clock_timestamp()>=p_deadline
    or ((clock_timestamp() at time zone 'Asia/Seoul')-interval '4 hours')::date<>p_day then return 'changed'; end if;
  insert into public.hamster_postponements(study_id,user_id,study_date) values(p_study,p_user,p_day) on conflict do nothing;
  return case when found then 'saved' else 'duplicate' end;
end $$;

revoke all on function public.hamster_read_progress_checkpoints(uuid,uuid,date),
  public.hamster_save_progress_checkpoints(uuid,bigint,jsonb),
  public.hamster_guarded_postponement(uuid,uuid,date,bigint,timestamptz),
  public.hamster_expire_progress_checkpoints() from public,anon,authenticated;
grant execute on function public.hamster_read_progress_checkpoints(uuid,uuid,date),
  public.hamster_save_progress_checkpoints(uuid,bigint,jsonb),
  public.hamster_guarded_postponement(uuid,uuid,date,bigint,timestamptz) to service_role;
