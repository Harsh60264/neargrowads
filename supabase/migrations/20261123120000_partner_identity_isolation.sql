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
