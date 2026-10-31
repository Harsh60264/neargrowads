-- Expiry is enforced by CMS authorization; this migration performs no Auth credential rotation.
revoke all on table public.admin_users, public.admin_sessions,
  public.admin_audit_logs, public.admin_ownership_transfers
  from public, anon, authenticated;
grant all on table public.admin_users, public.admin_sessions,
  public.admin_audit_logs, public.admin_ownership_transfers
  to service_role;

create or replace function public.get_active_admin_session(p_session_id uuid, p_user_id uuid)
returns table(session_id uuid, expires_at timestamptz)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select session.id, session.expires_at
  from public.admin_sessions as session
  join public.admin_users as account on account.id = session.user_id
  where session.id = p_session_id
    and session.user_id = p_user_id
    and session.revoked_at is null
    and session.expires_at > clock_timestamp()
    and account.status = 'active'
    and account.archived_at is null
    and (
      account.must_change_password is distinct from true
      or account.temporary_password_expires_at is null
      or (
        account.temporary_password_expires_at > clock_timestamp()
        and account.temporary_password_used_at is not null
      )
    )
  limit 1;
$$;

revoke all on function public.get_active_admin_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_active_admin_session(uuid, uuid) to service_role;

alter table public.admin_audit_logs
  add column if not exists idempotency_key text;

create unique index if not exists admin_audit_logs_idempotency_key_unique
  on public.admin_audit_logs (idempotency_key)
  where idempotency_key is not null;

create or replace function public.complete_admin_temporary_password_setup(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_row public.admin_users%rowtype;
  active_session public.admin_sessions%rowtype;
  audit_key text;
begin
  if p_user_id is null or p_session_id is null then
    return jsonb_build_object('status', 'rejected');
  end if;

  select *
  into target_row
  from public.admin_users
  where id = p_user_id
  for update;

  if not found
    or target_row.status is distinct from 'active'
    or target_row.archived_at is not null
    or target_row.is_primary_owner is distinct from false
    or target_row.must_change_password is distinct from true then
    return jsonb_build_object('status', 'not_eligible');
  end if;

  if target_row.temporary_password_expires_at is not null
    and (target_row.temporary_password_expires_at <= clock_timestamp()
      or target_row.temporary_password_used_at is null) then
    return jsonb_build_object('status', 'expired_or_not_consumed');
  end if;

  select *
  into active_session
  from public.admin_sessions
  where id = p_session_id
    and user_id = p_user_id
    and revoked_at is null
    and expires_at > clock_timestamp()
  for update;

  if not found then
    return jsonb_build_object('status', 'session_invalid');
  end if;

  update public.admin_sessions
  set revoked_at = clock_timestamp()
  where user_id = p_user_id
    and id <> p_session_id
    and revoked_at is null;

  update public.admin_users
  set must_change_password = false,
      temporary_password_expires_at = null,
      temporary_password_used_at = null,
      last_password_reset_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_user_id;

  audit_key := 'temporary-admin-password-setup:' || p_user_id::text || ':' || p_session_id::text;
  insert into public.admin_audit_logs (
    actor_id, target_id, action, section, details, idempotency_key
  )
  values (
    p_user_id,
    p_user_id,
    'auth.password.temporary_changed',
    'security',
    jsonb_build_object('sessionId', p_session_id),
    audit_key
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return jsonb_build_object('status', 'completed');
end;
$$;

revoke all on function public.complete_admin_temporary_password_setup(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_admin_temporary_password_setup(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
