create or replace function public.complete_admin_invitation(
  p_user_id uuid,
  p_email text,
  p_must_change_password boolean
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

  if not found or target_row.email <> lower(p_email) or target_row.is_primary_owner then
    return jsonb_build_object('status', 'rejected');
  end if;

  if target_row.status = 'active' then
    if exists (
      select 1
      from public.admin_audit_logs
      where target_id = p_user_id
        and actor_id = p_user_id
        and action = 'admin.invitation.accepted'
    ) then
      return jsonb_build_object('status', 'already_accepted');
    end if;
    return jsonb_build_object('status', 'rejected');
  end if;

  if target_row.status <> 'pending' then
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
    jsonb_build_object('activation', 'verified_identity_and_setup_complete'),
    completed_at
  );

  return jsonb_build_object('status', 'accepted');
end;
$$;

revoke all on function public.complete_admin_invitation(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.complete_admin_invitation(uuid, text, boolean) to service_role;
      