create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'super_admin', 'custom_admin')),
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  permissions jsonb not null default '{}'::jsonb,
  is_primary_owner boolean not null default false,
  invited_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_users_email_lowercase check (email = lower(email))
);

create unique index if not exists admin_users_single_primary_owner
  on public.admin_users (is_primary_owner) where is_primary_owner;
create unique index if not exists admin_users_email_unique on public.admin_users (email);

create table if not exists public.admin_sessions (
  id uuid primary key,
  user_id uuid not null references public.admin_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text not null default ''
);

create index if not exists admin_sessions_user_active
  on public.admin_sessions (user_id, expires_at desc) where revoked_at is null;

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.admin_users(id) on delete set null,
  target_id uuid references public.admin_users(id) on delete set null,
  action text not null,
  section text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at on public.admin_audit_logs (created_at desc);

create table if not exists public.admin_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.admin_users(id) on delete restrict,
  to_user_id uuid not null references public.admin_users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz
);

create unique index if not exists admin_ownership_one_pending_transfer
  on public.admin_ownership_transfers (from_user_id) where status = 'pending';

alter table public.admin_users enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.admin_ownership_transfers enable row level security;

grant all on public.admin_users to service_role;
grant all on public.admin_sessions to service_role;
grant all on public.admin_audit_logs to service_role;
grant all on public.admin_ownership_transfers to service_role;

create or replace function public.accept_admin_ownership_transfer(p_transfer_id uuid, p_recipient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer_row public.admin_ownership_transfers%rowtype;
begin
  select * into transfer_row
  from public.admin_ownership_transfers
  where id = p_transfer_id
    and to_user_id = p_recipient_id
    and status = 'pending'
    and expires_at > now()
  for update;

  if not found then
    raise exception 'No active ownership transfer is available for this account';
  end if;

  if not exists (
    select 1 from public.admin_users
    where id = transfer_row.from_user_id and role = 'owner' and status = 'active' and is_primary_owner
  ) or not exists (
    select 1 from public.admin_users
    where id = p_recipient_id and role = 'owner' and status = 'active'
  ) then
    raise exception 'Both owners must remain active to transfer ownership';
  end if;

  update public.admin_users set is_primary_owner = false, updated_at = now()
  where id = transfer_row.from_user_id;
  update public.admin_users set is_primary_owner = true, updated_at = now()
  where id = p_recipient_id;
  update public.admin_ownership_transfers
  set status = 'accepted', accepted_at = now()
  where id = transfer_row.id;
  insert into public.admin_audit_logs (actor_id, target_id, action, section, details)
  values (p_recipient_id, transfer_row.from_user_id, 'ownership.transfer.accepted', 'ownership',
    jsonb_build_object('transferId', transfer_row.id));
end;
$$;

revoke all on function public.accept_admin_ownership_transfer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_admin_ownership_transfer(uuid, uuid) to service_role;
