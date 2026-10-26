alter table public.admin_sessions
  add column if not exists last_activity_at timestamp with time zone not null default now();

update public.admin_sessions
set expires_at = least(expires_at, created_at + interval '3 hours'),
    last_activity_at = created_at
where revoked_at is null;

alter table public.admin_sessions
  alter column expires_at set default (now() + interval '3 hours');

create or replace function public.touch_admin_session(p_session_id uuid, p_user_id uuid)
returns table(expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  next_expiry timestamptz;
begin
  update public.admin_sessions as session
  set last_activity_at = v_now,
      expires_at = v_now + interval '3 hours'
  where session.id = p_session_id
    and session.user_id = p_user_id
    and session.revoked_at is null
    and session.expires_at > v_now
  returning session.expires_at into next_expiry;

  if next_expiry is not null then
    return query select next_expiry;
  end if;
end;
$$;

create or replace function public.get_active_admin_session(p_session_id uuid, p_user_id uuid)
returns table(session_id uuid, expires_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select session.id, session.expires_at
  from public.admin_sessions as session
  where session.id = p_session_id
    and session.user_id = p_user_id
    and session.revoked_at is null
    and session.expires_at > clock_timestamp()
  limit 1;
$$;

revoke all on function public.touch_admin_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.touch_admin_session(uuid, uuid) to service_role;
revoke all on function public.get_active_admin_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_active_admin_session(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
