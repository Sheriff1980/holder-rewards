create extension if not exists pgcrypto;

create table if not exists guilds (
  id text primary key,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists guild_settings (
  guild_id text primary key references guilds(id) on delete cascade,
  app_name text not null default 'Holder Rewards',
  reward_currency_name text not null default 'Points',
  public_wallet_visibility boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists discord_users (
  id text primary key,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null references discord_users(id) on delete cascade,
  chain text not null,
  address text not null,
  created_at timestamptz not null default now(),
  unique (chain, address),
  unique (discord_user_id, chain, address)
);

create table if not exists verification_nonces (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null,
  guild_id text not null,
  nonce text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists role_rules (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  role_id text not null,
  chain text not null,
  rule jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists role_sync_events (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  discord_user_id text not null,
  role_id text not null,
  action text not null check (action in ('add', 'remove', 'skip', 'error')),
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists point_transactions (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  discord_user_id text not null,
  amount bigint not null,
  source text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists wallets_discord_user_id_idx on wallets(discord_user_id);
create index if not exists role_rules_guild_id_idx on role_rules(guild_id);
create index if not exists point_transactions_guild_user_idx on point_transactions(guild_id, discord_user_id);

