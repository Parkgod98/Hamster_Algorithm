create table public.hamster_push_subscriptions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hamster_push_subscriptions_user_idx
on public.hamster_push_subscriptions(user_id);

create table public.hamster_notification_preferences(
  user_id uuid primary key references auth.users(id) on delete cascade,
  completion_enabled boolean not null default true,
  reminder_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.hamster_notification_deliveries(
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.hamster_studies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  study_date date not null,
  kind text not null check(kind in('completion','reminder')),
  sent_at timestamptz not null default now(),
  unique(study_id,user_id,study_date,kind)
);

create index hamster_notification_deliveries_user_date_idx
on public.hamster_notification_deliveries(user_id,study_date desc);

alter table public.hamster_push_subscriptions enable row level security;
alter table public.hamster_notification_preferences enable row level security;
alter table public.hamster_notification_deliveries enable row level security;
