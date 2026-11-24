-- Existing members still open their study. New invitations always go to its admins.
create function public.hamster_join_requires_approval(p_invite boolean,p_policy text)
returns boolean immutable language sql set search_path='' as $$
  select p_invite or p_policy='approval'
$$;
revoke all on function public.hamster_join_requires_approval(boolean,text) from public,anon,authenticated;
grant execute on function public.hamster_join_requires_approval(boolean,text) to service_role;

create or replace function public.hamster_keep_existing_membership() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.hamster_study_members
             where study_id = new.study_id and user_id = new.user_id) then
    return null;
  end if;
  if new.role = 'member'
     and exists (select 1 from public.hamster_studies where id = new.study_id and (not discoverable or join_policy = 'approval'))
     and not exists (select 1 from public.hamster_join_requests where study_id = new.study_id
                     and user_id = new.user_id and approved_by is not null) then
    insert into public.hamster_join_requests (study_id, user_id)
      values (new.study_id, new.user_id) on conflict do nothing;
    return null;
  end if;
  return new;
end $$;

create or replace function public.hamster_community_catalog(
  p_actor uuid, p_scope text, p_query text, p_code text, p_offset integer
) returns table (
  id uuid, name text, description text, member_count bigint, join_policy text,
  goals jsonb, member_role text, pending boolean
) language sql stable set search_path = '' as $$
  with candidates as materialized (
    select s.id, s.name, s.description, s.join_policy, s.discoverable, m.role
    from public.hamster_studies s
    left join public.hamster_study_members m on m.study_id = s.id and m.user_id = p_actor
    where case p_scope
      when 'mine' then m.role is not null
      when 'mine-with-requests' then m.role is not null or exists (
        select 1 from public.hamster_join_requests req where req.study_id = s.id and req.user_id = p_actor)
      when 'invite' then s.invite_code = p_code
      when 'search' then s.discoverable and strpos(lower(s.name), lower(p_query)) > 0
      else false end
    order by s.name, s.id limit 21 offset greatest(0, p_offset)
  )
  select s.id, s.name, s.description,
    (select count(*) from public.hamster_study_members members where members.study_id = s.id),
    case when p_scope = 'invite' or not s.discoverable then 'approval' else s.join_policy end, v.rule_config->'goals', s.role,
    exists(select 1 from public.hamster_join_requests req where req.study_id = s.id and req.user_id = p_actor)
  from candidates s
  cross join lateral (
    select rv.rule_config from public.hamster_study_rule_versions rv
    where rv.study_id = s.id and rv.effective_from <= ((now() at time zone 'Asia/Seoul') - interval '4 hours')::date
    order by rv.effective_from desc limit 1
  ) v
  order by s.name, s.id
$$;

create or replace function public.hamster_join_community_study(p_actor uuid, p_study_id uuid, p_code text)
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
  if public.hamster_join_requires_approval(p_code is not null,target.join_policy) then
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
