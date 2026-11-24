create table if not exists public.partner_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  mobile_number text not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  constraint partner_profiles_email_lowercase check (email = lower(email))
);

create unique index if not exists partner_profiles_email_unique
  on public.partner_profiles (email);

create table if not exists public.partner_sessions (
  id uuid primary key,
  user_id uuid not null references public.partner_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '8 hours'),
  revoked_at timestamptz,
  user_agent text not null default ''
);

create index if not exists partner_sessions_user_active
  on public.partner_sessions (user_id, expires_at desc)
  where revoked_at is null;

alter table public.partner_profiles enable row level security;
alter table public.partner_sessions enable row level security;

revoke all on public.partner_profiles, public.partner_sessions
  from public, anon, authenticated;

grant all on public.partner_profiles, public.partner_sessions
  to service_role;

create policy partner_profiles_no_direct_access
  on public.partner_profiles
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy partner_sessions_no_direct_access
  on public.partner_sessions
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.prevent_admin_partner_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.admin_users
    where id = new.id
  ) then
    raise exception 'An administrator identity cannot also be a delivery partner';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_admin_partner_profile()
  from public, anon, authenticated;

drop trigger if exists prevent_admin_partner_profile on public.partner_profiles;
create trigger prevent_admin_partner_profile
  before insert or update of id
  on public.partner_profiles
  for each row
  execute function public.prevent_admin_partner_profile();
