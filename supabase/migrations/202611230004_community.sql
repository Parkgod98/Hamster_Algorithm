-- Existing studies have historically been accessible by invitation only.
alter table public.hamster_studies
  add column description text not null default '' check (length(description) <= 1000),
  add column discoverable boolean not null default false,
  add column join_policy text not null default 'open' check (join_policy in ('open','approval')),
  alter column invite_code set default replace(gen_random_uuid()::text, '-', '');

-- Even fellow members with a user token must not be able to fetch the link.
revoke select on public.hamster_studies from public, anon, authenticated;
grant select (id, name, description, discoverable, join_policy, timezone, cutoff_hour,
  postpone_deadline_hour, postpone_deadline_minute, max_consecutive_postpone,
  max_presolve_days, created_by, created_at, rule_config)
  on public.hamster_studies to authenticated;

create table public.hamster_join_requests (
  study_id uuid not null references public.hamster_studies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  primary key (study_id, user_id)
);
alter table public.hamster_join_requests enable row level security;
create index hamster_study_members_user_idx on public.hamster_study_members (user_id, study_id);

-- Legacy app versions join with INSERT ... ON CONFLICT DO UPDATE. Treat a
-- repeat enrollment as a no-op even while those versions are still serving.
create function public.hamster_keep_existing_membership() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.hamster_study_members
             where study_id = new.study_id and user_id = new.user_id) then
    return null;
  end if;
  if new.role = 'member'
     and exists (select 1 from public.hamster_studies where id = new.study_id and join_policy = 'approval')
     and not exists (select 1 from public.hamster_join_requests where study_id = new.study_id
                     and user_id = new.user_id and approved_by is not null) then
    insert into public.hamster_join_requests (study_id, user_id)
      values (new.study_id, new.user_id) on conflict do nothing;
    return null;
  end if;
  return new;
end $$;
create trigger hamster_existing_membership before insert on public.hamster_study_members
  for each row execute function public.hamster_keep_existing_membership();

create function public.hamster_create_community_study(
  p_actor uuid, p_study_id uuid, p_name text, p_description text, p_discoverable boolean,
  p_join_policy text, p_config jsonb
) returns uuid language plpgsql set search_path = '' as $$
declare
  nickname text;
  created uuid;
begin
  if length(trim(p_name)) not between 1 and 80 then
    raise invalid_parameter_value;
  end if;
  select display_name into strict nickname from public.hamster_profiles where id = p_actor for share;
  insert into public.hamster_studies (id, name, created_by, description, discoverable, join_policy, rule_config)
    values (p_study_id, trim(p_name), p_actor, p_description, p_discoverable, p_join_policy, p_config)
    on conflict (id) do nothing returning id into created;
  if created is null then
    -- Repeating a create after a lost response returns the original study.
    select id into strict created from public.hamster_studies where id = p_study_id and created_by = p_actor;
    return created;
  end if;
  insert into public.hamster_study_members (study_id, user_id, display_name, role)
    values (created, p_actor, nickname, 'admin');
  return created;
end $$;

-- Return only discovery metadata, applying the current rules.
create function public.hamster_community_catalog(
  p_actor uuid, p_scope text, p_query text, p_code text, p_offset integer
) returns table (
  id uuid, name text, description text, member_count bigint, join_policy text,
  goals jsonb, member_role text, pending boolean
) language sql stable set search_path = '' as $$
  with candidates as materialized (
    select s.id, s.name, s.description, s.join_policy, m.role
    from public.hamster_studies s
    left join public.hamster_study_members m on m.study_id = s.id and m.user_id = p_actor
    where case p_scope
      when 'mine' then m.role is not null
      when 'invite' then s.invite_code = p_code
      when 'search' then s.discoverable and strpos(lower(s.name), lower(p_query)) > 0
      else false end
    order by s.name, s.id limit 21 offset greatest(0, p_offset)
  )
  select s.id, s.name, s.description,
    (select count(*) from public.hamster_study_members members where members.study_id = s.id),
    s.join_policy, v.rule_config->'goals', s.role,
    exists(select 1 from public.hamster_join_requests req where req.study_id = s.id and req.user_id = p_actor)
  from candidates s
  cross join lateral (
    select rv.rule_config from public.hamster_study_rule_versions rv
    where rv.study_id = s.id and rv.effective_from <= ((now() at time zone 'Asia/Seoul') - interval '4 hours')::date
    order by rv.effective_from desc limit 1
  ) v
  order by s.name, s.id
$$;

create function public.hamster_join_community_study(p_actor uuid, p_study_id uuid, p_code text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  target public.hamster_studies%rowtype;
  nickname text;
begin
  select * into strict target from public.hamster_studies s
  where (p_code is not null and s.invite_code = p_code)
    or (p_code is null and s.id = p_study_id and (s.discoverable or exists (
      select 1 from public.hamster_study_members m where m.study_id = s.id and m.user_id = p_actor)))
  for update;
  if exists (select 1 from public.hamster_study_members where study_id = target.id and user_id = p_actor) then
    return jsonb_build_object('studyId', target.id, 'status', 'joined');
  end if;
  if target.join_policy = 'approval' then
    insert into public.hamster_join_requests (study_id,user_id)
    values (target.id, p_actor) on conflict do nothing;
    return jsonb_build_object('studyId', target.id, 'status', 'pending');
  end if;
  select display_name into strict nickname from public.hamster_profiles where id = p_actor for share;
  insert into public.hamster_study_members (study_id, user_id, display_name)
    values (target.id, p_actor, nickname) on conflict do nothing;
  delete from public.hamster_join_requests where study_id = target.id and user_id = p_actor;
  return jsonb_build_object('studyId', target.id, 'status', 'joined');
end $$;

create function public.hamster_administer_community_study(
  p_actor uuid, p_study_id uuid, p_action text, p_target uuid, p_description text,
  p_discoverable boolean, p_join_policy text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  target public.hamster_studies%rowtype;
  nickname text;
begin
  perform 1 from public.hamster_study_members
    where study_id = p_study_id and user_id = p_actor and role = 'admin' for share;
  if not found then raise insufficient_privilege; end if;
  if p_action = 'read' then
    select * into strict target from public.hamster_studies where id = p_study_id;
    return jsonb_build_object('description', target.description, 'discoverable', target.discoverable,
      'joinPolicy', target.join_policy, 'members', (
        select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.display_name, 'role', m.role)
          order by m.joined_at, m.user_id), '[]'::jsonb)
        from public.hamster_study_members m where m.study_id = p_study_id), 'requests', (
        select coalesce(jsonb_agg(jsonb_build_object('id', req.user_id, 'name', pf.display_name)
          order by req.requested_at, req.user_id), '[]'::jsonb)
        from public.hamster_join_requests req join public.hamster_profiles pf on pf.id = req.user_id
        where req.study_id = p_study_id));
  end if;
  select * into strict target from public.hamster_studies where id = p_study_id for update;
  if p_action = 'invite' then
    return jsonb_build_object('code', target.invite_code);
  elsif p_action = 'configure' then
    update public.hamster_studies set description = p_description, discoverable = p_discoverable, join_policy = p_join_policy
    where id = target.id;
  elsif p_action = 'promote' then
    update public.hamster_study_members set role = 'admin' where study_id = target.id and user_id = p_target;
    if not found then raise no_data_found; end if;
  elsif p_action in ('approve', 'reject') then
    if p_action = 'approve' then
      update public.hamster_join_requests set approved_by = p_actor where study_id = target.id and user_id = p_target;
      if found then
        select display_name into strict nickname from public.hamster_profiles where id = p_target for share;
        insert into public.hamster_study_members (study_id,user_id,display_name)
          values (target.id,p_target,nickname) on conflict do nothing;
      end if;
    end if;
    delete from public.hamster_join_requests where study_id = target.id and user_id = p_target;
  else
    raise invalid_parameter_value;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.hamster_community_catalog(uuid,text,text,text,integer),
  public.hamster_create_community_study(uuid,uuid,text,text,boolean,text,jsonb),
  public.hamster_join_community_study(uuid,uuid,text),
  public.hamster_administer_community_study(uuid,uuid,text,uuid,text,boolean,text)
  from public, anon, authenticated;
grant execute on function public.hamster_community_catalog(uuid,text,text,text,integer),
  public.hamster_create_community_study(uuid,uuid,text,text,boolean,text,jsonb),
  public.hamster_join_community_study(uuid,uuid,text),
  public.hamster_administer_community_study(uuid,uuid,text,uuid,text,boolean,text)
  to service_role;
