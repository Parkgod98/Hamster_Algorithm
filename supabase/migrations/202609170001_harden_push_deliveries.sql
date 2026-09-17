alter table public.hamster_notification_deliveries
  add column if not exists subscription_id uuid references public.hamster_push_subscriptions(id) on delete cascade,
  add column if not exists status text not null default 'sent' check(status in('pending','sent','failed')),
  add column if not exists attempt_count integer not null default 0 check(attempt_count >= 0),
  add column if not exists attempted_at timestamptz,
  add column if not exists last_error text,
  add column if not exists last_status_code integer;

alter table public.hamster_notification_deliveries
  alter column sent_at drop not null,
  alter column sent_at drop default;

alter table public.hamster_notification_deliveries
  drop constraint if exists hamster_notification_deliveries_study_id_user_id_study_date_kind_key;

create unique index if not exists hamster_notification_deliveries_device_unique
on public.hamster_notification_deliveries(study_id,user_id,study_date,kind,subscription_id)
where subscription_id is not null;

create index if not exists hamster_notification_deliveries_retry_idx
on public.hamster_notification_deliveries(status,attempted_at)
where status <> 'sent';

-- Existing rows came from the first Push implementation before per-device delivery tracking.
-- Keep them as historical records only. New sends always include subscription_id and use
-- the per-device uniqueness rule above.
