-- Each scope keeps a bounded, durable journal. The private broadcast carries
-- only opaque routing keys, never a study ID, session token or journal entry.
create table public.hamster_sync_channel (
  singleton boolean primary key check (singleton),
  topic text not null default ('hamster.sync.' || gen_random_uuid()::text)
);
insert into public.hamster_sync_channel(singleton) values (true);

create table public.hamster_sync_heads (
  scope text primary key, revision bigint not null, history jsonb not null
);
create table public.hamster_sync_pending (
  xid bigint not null, scope text not null, hint jsonb not null,
  primary key (xid,scope,hint)
);
alter table public.hamster_sync_channel enable row level security;
alter table public.hamster_sync_heads enable row level security;
alter table public.hamster_sync_pending enable row level security;
revoke all on public.hamster_sync_channel, public.hamster_sync_heads, public.hamster_sync_pending from public,anon,authenticated;

create function public.hamster_queue_view_change(
  p_scope text,p_kind text,p_user uuid default null,p_day date default null,p_study uuid default null,p_id uuid default null
) returns void language sql security definer set search_path='' as $$
  insert into public.hamster_sync_pending(xid,scope,hint) values (
    txid_current(),p_scope,jsonb_strip_nulls(jsonb_build_object(
      'kind',p_kind,'userId',p_user,'date',p_day,'studyId',p_study,'id',p_id))
  ) on conflict do nothing
$$;

-- Acquire scope locks in the same order across writers, after application
-- statements finish. A backfill produces a single wake-up at commit.
create function public.hamster_flush_view_changes() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  batch record;
  previous_revision bigint;
  previous_history jsonb;
  merged jsonb;
  channel_topic text;
  scope_id uuid;
  routes text[] := '{}';
begin
  for batch in
    with collected as (
      delete from public.hamster_sync_pending where xid=new.xid returning scope,hint
    )
    select scope,jsonb_agg(hint order by hint) filter (where hint->>'kind'<>'session') as hints
    from collected group by scope order by scope
  loop
    if channel_topic is null then
      select topic into strict channel_topic from public.hamster_sync_channel where singleton;
    end if;
    routes := array_append(routes, md5(channel_topic || batch.scope));
    if batch.scope<>'catalog' then
      scope_id := substr(batch.scope,3)::uuid;
      if (left(batch.scope,2)='s:' and not exists (select 1 from public.hamster_studies where id=scope_id))
        or (left(batch.scope,2)='u:' and not exists (select 1 from public.hamster_profiles where id=scope_id)) then
        delete from public.hamster_sync_heads where scope=batch.scope;
        continue;
      end if;
    end if;
    -- Revoked sessions must wake their streams, without changing other devices' views.
    if batch.hints is null then continue; end if;
    insert into public.hamster_sync_heads values(batch.scope,0,'[]') on conflict do nothing;
    select revision,history into strict previous_revision,previous_history
      from public.hamster_sync_heads where scope=batch.scope for update;
    select jsonb_agg(hint order by revision) into merged from (
      select hint, (hint->>'rev')::bigint as revision from jsonb_array_elements(previous_history) hint
      union all
      select value || jsonb_build_object('rev',(previous_revision+ordinality)::text),previous_revision+ordinality
        from jsonb_array_elements(batch.hints) with ordinality
      order by revision desc limit 32
    ) recent;
    update public.hamster_sync_heads set revision=previous_revision+jsonb_array_length(batch.hints),history=merged
      where scope=batch.scope;
  end loop;
  if cardinality(routes)>0 then
    begin
      perform realtime.send(case when cardinality(routes)>128 then '{"all":true}'::jsonb
        else jsonb_build_object('routes',routes) end, 'invalidate',channel_topic,true);
    exception when others then
      -- A transport outage cannot roll back a solve. Reconnecting reads the journal.
      raise warning 'Hamster view change broadcast unavailable (%)',sqlstate;
    end;
  end if;
  return null;
end $$;
create constraint trigger hamster_flush_view_changes after insert on public.hamster_sync_pending
  deferrable initially deferred for each row execute function public.hamster_flush_view_changes();

-- Record both old and new targets when a correction moves a solve to another
-- day, member or study. Identical hints coalesce within the transaction.
create function public.hamster_sync_activity_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  item jsonb;
  day date;
begin
  for item in select distinct value from jsonb_array_elements(
    case when tg_op='INSERT' then jsonb_build_array(to_jsonb(new))
      when tg_op='DELETE' then jsonb_build_array(to_jsonb(old))
      else jsonb_build_array(to_jsonb(old),to_jsonb(new)) end)
  loop
    day := case when tg_argv[0]='submission' then
      (((item->>'solved_at')::timestamptz at time zone 'Asia/Seoul')-interval '4 hours')::date
      else (item->>'study_date')::date end;
    perform public.hamster_queue_view_change('s:' || (item->>'study_id'), tg_argv[0], (item->>'user_id')::uuid, day,
      null, case when tg_argv[0]='goal' then (item->>'id')::uuid end);
  end loop;
  return null;
end $$;
create trigger hamster_sync_submission after insert or update or delete on public.hamster_submissions
  for each row execute function public.hamster_sync_activity_change('submission');
create trigger hamster_sync_goal after insert or update or delete on public.hamster_goal_completions
  for each row execute function public.hamster_sync_activity_change('goal');
create trigger hamster_sync_postponement after insert or update or delete on public.hamster_postponements
  for each row execute function public.hamster_sync_activity_change('postponement');
create trigger hamster_sync_penalty after insert or update or delete on public.hamster_penalties
  for each row execute function public.hamster_sync_activity_change('penalty');

create function public.hamster_sync_photo_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform public.hamster_queue_view_change('s:'||g.study_id,'goal',g.user_id,g.study_date,null,g.id)
    from public.hamster_goal_completions g where g.id=case when tg_op='DELETE' then old.completion_id else new.completion_id end;
  return null;
end $$;
create trigger hamster_sync_photo after insert or update or delete on public.hamster_goal_photos
  for each row execute function public.hamster_sync_photo_change();

create index hamster_submissions_problem_idx on public.hamster_submissions(problem_id);
create function public.hamster_sync_problem_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform public.hamster_queue_view_change('s:'||r.study_id,'submission',r.user_id,r.day)
    from (select distinct study_id,user_id,((solved_at at time zone 'Asia/Seoul')-interval '4 hours')::date as day
          from public.hamster_submissions where problem_id=new.id) r;
  return null;
end $$;
create trigger hamster_sync_problem after update on public.hamster_problems for each row
  when ((old.platform,old.external_id,old.title,old.difficulty) is distinct from (new.platform,new.external_id,new.title,new.difficulty))
  execute function public.hamster_sync_problem_change();

create function public.hamster_sync_community_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  current_row jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  study uuid;
  actor uuid;
  visible boolean;
  moved boolean := false;
begin
  if tg_table_name='hamster_studies' then
    if tg_op='UPDATE' and (old.name,old.description,old.join_policy,old.discoverable)
      is not distinct from (new.name,new.description,new.join_policy,new.discoverable) then return null; end if;
    perform public.hamster_queue_view_change('s:'||(current_row->>'id'),'metadata');
    if (tg_op<>'DELETE' and new.discoverable) or (tg_op<>'INSERT' and old.discoverable) then
      perform public.hamster_queue_view_change('catalog','catalog');
    end if;
    return null;
  end if;
  study := (current_row->>'study_id')::uuid;
  actor := (current_row->>'user_id')::uuid;
  select discoverable into visible from public.hamster_studies where id=study;
  if tg_table_name='hamster_study_members' then
    if tg_op='UPDATE' and old is not distinct from new then return null; end if;
    if tg_op='UPDATE' then moved := (old.study_id,old.user_id) is distinct from (new.study_id,new.user_id); end if;
    if moved then
      perform public.hamster_queue_view_change('s:'||old.study_id,'member',old.user_id);
      perform public.hamster_queue_view_change('u:'||old.user_id,'mine');
      if exists (select 1 from public.hamster_studies where id=old.study_id and discoverable) then
        perform public.hamster_queue_view_change('catalog','catalog');
      end if;
    end if;
    perform public.hamster_queue_view_change('s:'||study,'member',actor);
    if tg_op<>'UPDATE' or moved or old.role is distinct from new.role then
      perform public.hamster_queue_view_change('u:'||actor,'mine');
    end if;
    if visible and (tg_op<>'UPDATE' or moved) then perform public.hamster_queue_view_change('catalog','catalog'); end if;
  elsif tg_table_name='hamster_study_rule_versions' then
    if tg_op='UPDATE' and (old.study_id,old.effective_from) is distinct from (new.study_id,new.effective_from) then
      perform public.hamster_queue_view_change('s:'||old.study_id,'rules',null,old.effective_from);
    end if;
    perform public.hamster_queue_view_change('s:'||study,'rules',null,(current_row->>'effective_from')::date);
    if visible then perform public.hamster_queue_view_change('catalog','catalog'); end if;
  elsif tg_table_name='hamster_join_requests' then
    perform public.hamster_queue_view_change('u:'||actor,'mine');
    perform public.hamster_queue_view_change('u:'||user_id,'manage',null,null,study)
      from public.hamster_study_members where study_id=study and role='admin';
  end if;
  return null;
end $$;
create trigger hamster_sync_study after insert or update or delete on public.hamster_studies
  for each row execute function public.hamster_sync_community_change();
create trigger hamster_sync_member after insert or update or delete on public.hamster_study_members
  for each row execute function public.hamster_sync_community_change();
create trigger hamster_sync_rules after insert or update or delete on public.hamster_study_rule_versions
  for each row execute function public.hamster_sync_community_change();
create trigger hamster_sync_join after insert or update or delete on public.hamster_join_requests
  for each row execute function public.hamster_sync_community_change();

create function public.hamster_sync_account_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and old is not distinct from new then return null; end if;
  if tg_table_name='hamster_profiles' then
    perform public.hamster_queue_view_change('u:'||(case when tg_op='DELETE' then old.id else new.id end), 'profile');
    if tg_op='UPDATE' and old.display_name is distinct from new.display_name then
      perform public.hamster_queue_view_change('u:'||m.user_id,'manage',null,null,r.study_id)
        from public.hamster_join_requests r join public.hamster_study_members m
          on m.study_id=r.study_id and m.role='admin' where r.user_id=new.id;
    end if;
  else
    if tg_op<>'INSERT' then perform public.hamster_queue_view_change('u:'||old.user_id,tg_argv[0]); end if;
    if tg_op<>'DELETE' then perform public.hamster_queue_view_change('u:'||new.user_id,tg_argv[0]); end if;
  end if;
  return null;
end $$;
create trigger hamster_sync_profile after insert or update or delete on public.hamster_profiles
  for each row execute function public.hamster_sync_account_change();
create trigger hamster_sync_installation after insert or update or delete on public.hamster_github_installations
  for each row execute function public.hamster_sync_account_change('repos');
create trigger hamster_sync_repository after insert or update or delete on public.hamster_repository_connections
  for each row execute function public.hamster_sync_account_change('repos');
create trigger hamster_sync_device after insert or update or delete on public.hamster_push_subscriptions
  for each row execute function public.hamster_sync_account_change('push');
create trigger hamster_sync_preference after insert or update or delete on public.hamster_notification_preferences
  for each row execute function public.hamster_sync_account_change('push');
create trigger hamster_sync_revoked after delete on public.hamster_account_sessions
  for each row execute function public.hamster_sync_account_change('session');

-- A single MVCC snapshot proves session validity and filters study scopes using
-- current membership, including immediately after a join or removal.
create function public.hamster_sync_snapshot(p_session_hash text) returns jsonb
language sql stable security definer set search_path='' as $$
  with actor as (select user_id from public.hamster_account_sessions where token_hash=p_session_hash),
  scopes as (
    select 'catalog' as scope,'catalog' as kind,null::uuid as id from actor union all
    select 'u:'||user_id,'account',null from actor union all
    select 's:'||m.study_id,'study',m.study_id from public.hamster_study_members m join actor using(user_id)
  ), state as (
    select s.*,coalesce(h.revision,0)::text as rev,coalesce(h.history,'[]'::jsonb) as hints
    from scopes s left join public.hamster_sync_heads h using(scope)
  )
  select jsonb_build_object('topic',c.topic,'routes',(select jsonb_agg(md5(c.topic||scope)) from state),
    'snapshot',jsonb_build_object(
      'catalog',(select rev from state where kind='catalog'),'account',(select rev from state where kind='account'),
      'studies',coalesce((select jsonb_object_agg(id,rev) from state where kind='study'),'{}'::jsonb),
      'changes',jsonb_build_object(
        'catalog',(select hints from state where kind='catalog'),
        'account',coalesce((select jsonb_agg(case when h->>'kind'='manage' and not exists (
          select 1 from public.hamster_study_members m where m.user_id=actor.user_id
          and m.study_id=(h->>'studyId')::uuid and m.role='admin'
        ) then jsonb_build_object('rev',h->>'rev','kind','mine') else h end order by ord)
          from state cross join lateral jsonb_array_elements(hints) with ordinality as log(h,ord)
          where kind='account'),'[]'::jsonb),
        'studies',coalesce((select jsonb_object_agg(id,hints) from state where kind='study'),'{}'::jsonb))))
  from public.hamster_sync_channel c cross join actor where c.singleton
$$;
revoke all on function public.hamster_sync_snapshot(text),
  public.hamster_queue_view_change(text,text,uuid,date,uuid,uuid),public.hamster_flush_view_changes(),
  public.hamster_sync_activity_change(),public.hamster_sync_problem_change(),public.hamster_sync_photo_change(),public.hamster_sync_community_change(),
  public.hamster_sync_account_change() from public,anon,authenticated;
grant execute on function public.hamster_sync_snapshot(text) to service_role;
