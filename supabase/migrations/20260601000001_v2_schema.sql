-- MonkeMask v2 — foundation schema (Phase 1, Task 3).
-- Tables: allowlist, auth_nonces, wrapped_keys, audit_log + RLS.
-- RLS is enabled on every table. With RLS on and NO permissive policy for a given
-- operation, the `anon`/`authenticated` roles are denied; only the `service_role`
-- (used by server-side API routes) bypasses RLS. So all writes here are
-- service-role-only by construction, and clients get exactly the narrow SELECTs
-- defined below, scoped by their JWT `wallet_pubkey` / `role` claims.

-- ============================================================ allowlist
create table if not exists public.allowlist (
  id            uuid primary key default gen_random_uuid(),
  wallet_pubkey text not null unique,
  role          text not null check (role in ('ambassador', 'global_admin', 'super_admin')),
  country       text,                       -- ISO code, required for ambassadors
  added_by      text,
  added_at      timestamptz not null default now(),
  removed_at    timestamptz,
  notes         text,
  constraint ambassador_has_country check (role <> 'ambassador' or country is not null)
);
alter table public.allowlist enable row level security;

-- ============================================================ auth_nonces
-- Single-use SIWS nonces. Managed only by the service role (no client policy).
create table if not exists public.auth_nonces (
  nonce      text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
alter table public.auth_nonces enable row level security;

-- ============================================================ wrapped_keys
-- A data key (per-country CK or global GK) wrapped to a wallet's KEK. The server
-- never sees the unwrapped key; the browser unwraps it after the wallet re-signs.
create table if not exists public.wrapped_keys (
  id            uuid primary key default gen_random_uuid(),
  wallet_pubkey text not null,
  scope         text not null,              -- e.g. 'country:AR' or 'global'
  wrapped_key   bytea not null,
  iv            bytea not null,
  key_version   int  not null default 1,
  created_at    timestamptz not null default now(),
  superseded_at timestamptz
);
-- At most one active wrapped key per (wallet, scope).
create unique index if not exists wrapped_keys_active_uq
  on public.wrapped_keys (wallet_pubkey, scope) where superseded_at is null;
alter table public.wrapped_keys enable row level security;

-- ============================================================ audit_log (append-only)
create table if not exists public.audit_log (
  id             bigserial primary key,
  actor_wallet   text,
  action         text not null,
  target_country text,
  target_id      text,
  metadata       jsonb,
  created_at     timestamptz not null default now()
);
alter table public.audit_log enable row level security;

create or replace function public.audit_log_immutable() returns trigger
  language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

drop trigger if exists audit_log_no_mutate on public.audit_log;
create trigger audit_log_no_mutate
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- ============================================================ RLS policies
-- allowlist: a wallet may read only its own row. Writes are service-role-only.
drop policy if exists allowlist_select_own on public.allowlist;
create policy allowlist_select_own on public.allowlist
  for select using (auth.jwt() ->> 'wallet_pubkey' = wallet_pubkey);

-- wrapped_keys: a wallet may read only its own ACTIVE wrapped keys. No client writes.
drop policy if exists wrapped_keys_select_own on public.wrapped_keys;
create policy wrapped_keys_select_own on public.wrapped_keys
  for select using (
    auth.jwt() ->> 'wallet_pubkey' = wallet_pubkey and superseded_at is null
  );

-- audit_log: only a super_admin JWT may read. Inserts are service-role-only.
drop policy if exists audit_log_select_super on public.audit_log;
create policy audit_log_select_super on public.audit_log
  for select using (auth.jwt() ->> 'role' = 'super_admin');

-- auth_nonces: RLS enabled, no policy -> service-role-only (correct).
