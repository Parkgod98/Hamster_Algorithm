create table public.hamster_account_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login_id text unique not null,
  password_hash text not null,
  question_id text not null,
  answer_hash text not null
);
create table public.hamster_account_sessions (
  token_hash text primary key,
  user_id uuid not null references public.hamster_account_credentials(user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index hamster_account_session_user on public.hamster_account_sessions(user_id);
create table public.hamster_account_attempts (
  user_id uuid not null references public.hamster_account_credentials(user_id) on delete cascade,
  purpose text not null,
  window_start timestamptz not null,
  attempts integer not null,
  primary key(user_id, purpose)
);
alter table public.hamster_account_credentials enable row level security;
alter table public.hamster_account_sessions enable row level security;
alter table public.hamster_account_attempts enable row level security;

-- During the preview rollout, the previous server still writes the GitHub
-- name when an invite is opened. Only explicit rename/registration may change
-- a nickname after the account has been upgraded.
create function public.hamster_preserve_registered_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('hamster.edit_account_name',true) is distinct from 'on' and exists(
    select 1 from public.hamster_account_credentials where user_id=old.id
  ) then new.display_name := old.display_name; end if;
  return new;
end
$$;
create trigger hamster_preserve_registered_name before update of display_name on public.hamster_profiles
for each row execute function public.hamster_preserve_registered_name();

create function public.hamster_rename_account(p_user uuid,p_nickname text) returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('hamster.edit_account_name','on',true);
  update public.hamster_profiles set display_name=p_nickname where id=p_user;
  if not found then raise exception 'Missing account profile'; end if;
end
$$;

-- Keep the existing membership fields consistent for calendar/statistics readers.
create function public.hamster_sync_account_name() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.hamster_study_members set display_name = new.display_name
    where user_id = new.id and display_name is distinct from new.display_name;
  return new;
end
$$;
create trigger hamster_sync_name after update of display_name on public.hamster_profiles
for each row when (new.display_name is not null and old.display_name is distinct from new.display_name)
execute function public.hamster_sync_account_name();

create function public.hamster_register_account(
  p_user uuid, p_login text, p_nickname text, p_password text, p_question text, p_answer text, p_token text
) returns void language plpgsql set search_path = '' as $$
begin
  insert into public.hamster_account_credentials(user_id, login_id, password_hash, question_id, answer_hash)
    values(p_user, p_login, p_password, p_question, p_answer);
  perform set_config('hamster.edit_account_name','on',true);
  insert into public.hamster_profiles(id, display_name) values(p_user, p_nickname)
    on conflict(id) do update set display_name=excluded.display_name;
  insert into public.hamster_account_sessions(token_hash,user_id) values(p_token,p_user);
end
$$;
create function public.hamster_consume_account_attempt(p_user uuid,p_purpose text)
returns boolean language sql set search_path = '' as $$
  insert into public.hamster_account_attempts(user_id,purpose,window_start,attempts)
  values(p_user,p_purpose,now(),1) on conflict(user_id,purpose) do update set
    attempts = case when hamster_account_attempts.window_start <= now()-interval '15 minutes'
                    then 1 else least(hamster_account_attempts.attempts+1,13) end,
    window_start = case when hamster_account_attempts.window_start <= now()-interval '15 minutes'
                    then now() else hamster_account_attempts.window_start end
  returning attempts <= 12
$$;
-- A password reset cannot race an in-flight login into issuing a stale session.
create function public.hamster_start_account_session(p_user uuid,p_expected text,p_token text)
returns boolean language plpgsql set search_path = '' as $$
begin
  perform 1 from public.hamster_account_credentials where user_id=p_user and password_hash=p_expected for update;
  if not found then return false; end if;
  insert into public.hamster_account_sessions(token_hash,user_id) values(p_token,p_user);
  delete from public.hamster_account_attempts where user_id=p_user and purpose='login';
  return true;
end
$$;
create function public.hamster_reset_account_password(p_user uuid,p_expected text,p_password text)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.hamster_account_credentials set password_hash=p_password where user_id=p_user and password_hash=p_expected;
  if not found then return false; end if;
  delete from public.hamster_account_sessions where user_id=p_user;
  delete from public.hamster_account_attempts where user_id=p_user;
  return true;
end
$$;
revoke all on function public.hamster_rename_account(uuid,text), public.hamster_register_account(uuid,text,text,text,text,text,text),
  public.hamster_consume_account_attempt(uuid,text), public.hamster_start_account_session(uuid,text,text),
  public.hamster_reset_account_password(uuid,text,text) from public,anon,authenticated;
grant execute on function public.hamster_rename_account(uuid,text), public.hamster_register_account(uuid,text,text,text,text,text,text),
  public.hamster_consume_account_attempt(uuid,text), public.hamster_start_account_session(uuid,text,text),
  public.hamster_reset_account_password(uuid,text,text) to service_role;
