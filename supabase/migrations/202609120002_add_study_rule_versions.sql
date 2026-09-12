create table if not exists public.hamster_study_rule_versions(
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.hamster_studies(id) on delete cascade,
  effective_from date not null,
  rule_config jsonb not null,
  postpone_deadline_hour smallint not null check(postpone_deadline_hour between 0 and 23),
  postpone_deadline_minute smallint not null check(postpone_deadline_minute between 0 and 59),
  max_consecutive_postpone smallint not null check(max_consecutive_postpone between 0 and 7),
  max_presolve_days smallint not null check(max_presolve_days between 0 and 14),
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(study_id,effective_from),
  constraint hamster_study_rule_versions_config_object_check check(jsonb_typeof(rule_config) = 'object')
);

insert into public.hamster_study_rule_versions(
  study_id,
  effective_from,
  rule_config,
  postpone_deadline_hour,
  postpone_deadline_minute,
  max_consecutive_postpone,
  max_presolve_days,
  changed_by
)
select
  id,
  ((created_at at time zone 'Asia/Seoul') - interval '4 hours')::date,
  rule_config,
  postpone_deadline_hour,
  postpone_deadline_minute,
  max_consecutive_postpone,
  max_presolve_days,
  created_by
from public.hamster_studies
on conflict (study_id,effective_from) do nothing;

create index if not exists hamster_rule_versions_study_effective_idx
on public.hamster_study_rule_versions(study_id,effective_from desc);

alter table public.hamster_study_rule_versions enable row level security;

create policy hamster_rule_versions_study_read
on public.hamster_study_rule_versions
for select
using(public.hamster_is_study_member(study_id,auth.uid()));
