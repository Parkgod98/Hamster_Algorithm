create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  github_login text,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.studies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Seoul',
  cutoff_hour smallint not null default 4 check (cutoff_hour between 0 and 23),
  postpone_deadline_hour smallint not null default 23,
  postpone_deadline_minute smallint not null default 59,
  max_consecutive_postpone smallint not null default 2,
  max_presolve_days smallint not null default 2,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.study_members (
  study_id uuid not null references public.studies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('admin','member')),
  boj_minimum_difficulty text,
  joined_at timestamptz not null default now(),
  primary key (study_id, user_id)
);

create table public.github_installations (
  installation_id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_login text,
  created_at timestamptz not null default now()
);

create table public.repository_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  study_id uuid not null references public.studies(id) on delete cascade,
  installation_id bigint references public.github_installations(installation_id) on delete set null,
  github_repository_id bigint not null unique,
  full_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('BOJ','PROGRAMMERS','SWEA','CODETREE')),
  external_id text not null,
  title text not null,
  difficulty text not null,
  created_at timestamptz not null default now(),
  unique (platform, external_id)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  study_id uuid not null references public.studies(id) on delete cascade,
  repository_connection_id uuid references public.repository_connections(id) on delete set null,
  problem_id uuid not null references public.problems(id),
  solved_at timestamptz not null,
  source text not null check (source in ('github','manual','extension','backfill')),
  source_event_id text not null unique,
  created_at timestamptz not null default now()
);

create index submissions_study_user_solved_idx on public.submissions(study_id, user_id, solved_at);

create table public.postponements (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  study_date date not null,
  requested_at timestamptz not null default now(),
  unique(study_id, user_id, study_date)
);

create table public.penalties (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  study_date date not null,
  consecutive_misses smallint not null,
  amount integer,
  reason text not null default 'missed',
  created_at timestamptz not null default now(),
  unique(study_id, user_id, study_date)
);

create table public.webhook_events (
  delivery_id text primary key,
  event_name text not null,
  repository_id bigint,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.studies enable row level security;
alter table public.study_members enable row level security;
alter table public.repository_connections enable row level security;
alter table public.problems enable row level security;
alter table public.submissions enable row level security;
alter table public.postponements enable row level security;
alter table public.penalties enable row level security;

create policy profiles_self on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy studies_member_read on public.studies for select using (exists (select 1 from public.study_members sm where sm.study_id = id and sm.user_id = auth.uid()));
create policy members_same_study_read on public.study_members for select using (exists (select 1 from public.study_members me where me.study_id = study_id and me.user_id = auth.uid()));
create policy repo_owner_read on public.repository_connections for select using (user_id = auth.uid());
create policy problems_authenticated_read on public.problems for select to authenticated using (true);
create policy submissions_study_read on public.submissions for select using (exists (select 1 from public.study_members sm where sm.study_id = submissions.study_id and sm.user_id = auth.uid()));
create policy postponements_study_read on public.postponements for select using (exists (select 1 from public.study_members sm where sm.study_id = postponements.study_id and sm.user_id = auth.uid()));
create policy postponements_self_insert on public.postponements for insert with check (user_id = auth.uid() and exists (select 1 from public.study_members sm where sm.study_id = postponements.study_id and sm.user_id = auth.uid()));
create policy penalties_study_read on public.penalties for select using (exists (select 1 from public.study_members sm where sm.study_id = penalties.study_id and sm.user_id = auth.uid()));
