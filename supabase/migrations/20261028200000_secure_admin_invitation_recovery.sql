alter table public.admin_users
  add column if not exists invitation_generation uuid;

drop function if exists public.complete_admin_invitation(uuid, text, boolean);

create or replace function public.complete_admin_invitation(
  p_user_id uuid,
  p_email text,
  p_must_change_password boolean,
  p_invitation_generation uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_row public.admin_users%rowtype;
  completed_at timestamptz := now();
begin
  select *
  into target_row
  from public.admin_users
  where id = p_user_id
  for update;

  if p_user_id is null
    or not found
    or p_email is null
    or p_email ~ '^[[:space:]]*$'
    or p_must_change_password is null
    or p_invitation_generation is null
    or target_row.email is distinct from lower(btrim(p_email))
    or target_row.invitation_generation is distinct from p_invitation_generation
    or target_row.is_primary_owner is distinct from false then
    return jsonb_build_object('status', 'rejected');
  end if;

  if target_row.status = 'active' then
    if exists (
      select 1
      from public.admin_audit_logs
      where target_id = p_user_id
        and actor_id = p_user_id
        and action = 'admin.invitation.accepted'
        and details ->> 'invitationGeneration' = p_invitation_generation::text
    ) then
      return jsonb_build_object('status', 'already_accepted');
    end if;
    return jsonb_build_object('status', 'rejected');
  end if;

  if target_row.status is distinct from 'pending' then
    return jsonb_build_object('status', 'rejected');
  end if;

  update public.admin_users
  set status = 'active',
      must_change_password = p_must_change_password,
      updated_at = completed_at
  where id = p_user_id;

  insert into public.admin_audit_logs (actor_id, target_id, action, section, details, created_at)
  values (
    p_user_id,
    p_user_id,
    'admin.invitation.accepted',
    'settings',
    jsonb_build_object(
      'activation', 'verified_identity_and_setup_complete',
      'invitationGeneration', p_invitation_generation
    ),
    completed_at
  );

  return jsonb_build_object('status', 'accepted');
end;
$$;

revoke all on function public.complete_admin_invitation(uuid, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.complete_admin_invitation(uuid, text, boolean, uuid) to service_role;

create or replace function public.prepare_admin_invitation_recovery(
  p_actor_id uuid,
  p_target_id uuid,
  p_invitation_generation uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_row public.admin_users%rowtype;
  prepared_at timestamptz := now();
begin
  if p_actor_id is null or p_invitation_generation is null then
    return jsonb_build_object('status', 'rejected');
  end if;

  perform 1
  from public.admin_users
  where id = p_actor_id
    and role = 'owner'
    and status = 'active'
    and is_primary_owner
  for share;

  if not found then
    return jsonb_build_object('status', 'rejected');
  end if;

  select *
  into target_row
  from public.admin_users
  where id = p_target_id
  for update;

  if p_target_id is null
    or not found
    or target_row.is_primary_owner is distinct from false
    or (target_row.status is distinct from 'pending' and target_row.status is distinct from 'disabled') then
    return jsonb_build_object('status', 'rejected');
  end if;

  update public.admin_users
  set status = 'pending',
      username = case when target_row.status = 'disabled' then null else username end,
      permissions = case when target_row.status = 'disabled' then '{}'::jsonb else permissions end,
      must_change_password = true,
      invitation_generation = p_invitation_generation,
      updated_at = prepared_at
  where id = p_target_id;

  update public.admin_sessions
  set revoked_at = prepared_at
  where user_id = p_target_id
    and revoked_at is null;

  insert into public.admin_audit_logs (actor_id, target_id, action, section, details, created_at)
  values (
    p_actor_id,
    p_target_id,
    'admin.invitation.reissued',
    'settings',
    jsonb_build_object(
      'previousStatus', target_row.status,
      'permissionsCleared', target_row.status = 'disabled',
      'authIdentityRetained', true
    ),
    prepared_at
  );

  return jsonb_build_object('status', 'prepared', 'previousStatus', target_row.status);
end;
$$;

revoke all on function public.prepare_admin_invitation_recovery(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_admin_invitation_recovery(uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
