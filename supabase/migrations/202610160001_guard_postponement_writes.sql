-- 설정값, 규칙 이력, 미루기 기록, 확정 벌금은 변경하지 않습니다.
-- 기존 API는 service_role로 저장하므로 기존 버전과도 호환됩니다.
begin;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'hamster_postponements'
      and policyname = 'hamster_postponements_self_insert'
  ) then
    drop policy hamster_postponements_self_insert on public.hamster_postponements;
  end if;
end;
$$;

revoke insert on public.hamster_postponements from anon, authenticated;

commit;
