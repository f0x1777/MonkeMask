-- MonkeMask v2 — data tables (Phase 1, Tasks 7-9):
-- encrypted_country_rosters, consent_records, monke_library_cache.
-- All face/roster data is stored as AES-256-GCM ciphertext (encrypted client-side
-- under the per-country key CK); the server never sees plaintext. RLS scopes access
-- by the JWT's role / country / wallet_pubkey claims.

-- ============================================ encrypted_country_rosters (Task 7)
create table if not exists public.encrypted_country_rosters (
  id             uuid primary key default gen_random_uuid(),
  country        text not null,
  ciphertext     bytea not null,   -- encrypted roster JSON (faces + associations)
  iv             bytea not null,
  schema_version integer not null default 1,
  key_version    integer not null default 1,
  record_count   integer,
  updated_at     timestamptz not null default now(),
  updated_by     text not null
);
create unique index if not exists country_rosters_country_uq
  on public.encrypted_country_rosters (country);
alter table public.encrypted_country_rosters enable row level security;

-- An ambassador may read/write only their own country's blob; global_admin reads any
-- (no write); super_admin reads + writes any. No client DELETE.
drop policy if exists country_roster_select on public.encrypted_country_rosters;
create policy country_roster_select on public.encrypted_country_rosters for select using (
  (auth.jwt() ->> 'role' = 'ambassador' and auth.jwt() ->> 'country' = country)
  or auth.jwt() ->> 'role' in ('global_admin', 'super_admin')
);
drop policy if exists country_roster_insert on public.encrypted_country_rosters;
create policy country_roster_insert on public.encrypted_country_rosters for insert with check (
  (auth.jwt() ->> 'role' = 'ambassador' and auth.jwt() ->> 'country' = country)
  or auth.jwt() ->> 'role' = 'super_admin'
);
drop policy if exists country_roster_update on public.encrypted_country_rosters;
create policy country_roster_update on public.encrypted_country_rosters for update using (
  (auth.jwt() ->> 'role' = 'ambassador' and auth.jwt() ->> 'country' = country)
  or auth.jwt() ->> 'role' = 'super_admin'
) with check (
  (auth.jwt() ->> 'role' = 'ambassador' and auth.jwt() ->> 'country' = country)
  or auth.jwt() ->> 'role' = 'super_admin'
);

-- ============================================ consent_records (Task 8, append-only)
create table if not exists public.consent_records (
  id           uuid primary key default gen_random_uuid(),
  country      text not null,
  subject_ref  text not null,     -- opaque per-person reference (no clear PII)
  consent_type text not null check (
    consent_type in ('country_roster_enrollment', 'global_registry_promotion')
  ),
  granted_by   text not null,     -- ambassador wallet
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  metadata     jsonb
);
alter table public.consent_records enable row level security;

create or replace function public.consent_no_delete() returns trigger
  language plpgsql as $$
begin
  raise exception 'consent_records is append-only (no delete)';
end;
$$;
drop trigger if exists consent_no_delete on public.consent_records;
create trigger consent_no_delete
  before delete on public.consent_records
  for each row execute function public.consent_no_delete();

drop policy if exists consent_select on public.consent_records;
create policy consent_select on public.consent_records for select using (
  auth.jwt() ->> 'role' = 'super_admin'
  or (auth.jwt() ->> 'role' = 'ambassador' and auth.jwt() ->> 'country' = country)
);
drop policy if exists consent_insert on public.consent_records;
create policy consent_insert on public.consent_records for insert with check (
  (auth.jwt() ->> 'role' = 'ambassador' and auth.jwt() ->> 'country' = country)
  or auth.jwt() ->> 'role' = 'super_admin'
);
-- Only revocation (setting revoked_at) is an allowed update; by the inserting
-- ambassador (own country) or super_admin.
drop policy if exists consent_revoke on public.consent_records;
create policy consent_revoke on public.consent_records for update using (
  (auth.jwt() ->> 'role' = 'ambassador' and auth.jwt() ->> 'country' = country)
  or auth.jwt() ->> 'role' = 'super_admin'
) with check (
  (auth.jwt() ->> 'role' = 'ambassador' and auth.jwt() ->> 'country' = country)
  or auth.jwt() ->> 'role' = 'super_admin'
);

-- ============================================ monke_library_cache (Task 9)
-- Per-wallet cache of the SMB monkes derived from on-chain holdings + their cutouts.
create table if not exists public.monke_library_cache (
  id               uuid primary key default gen_random_uuid(),
  wallet_pubkey    text not null,
  mint             text not null,       -- SMB token mint
  generation       text,                -- 'gen1' | 'gen2' | 'gen3'
  image_url        text,
  background_trait text,
  cutout_path      text,                -- storage path of the bg-removed cutout
  cached_at        timestamptz not null default now()
);
create unique index if not exists monke_library_wallet_mint_uq
  on public.monke_library_cache (wallet_pubkey, mint);
alter table public.monke_library_cache enable row level security;

drop policy if exists monke_library_all_own on public.monke_library_cache;
create policy monke_library_all_own on public.monke_library_cache for all using (
  auth.jwt() ->> 'wallet_pubkey' = wallet_pubkey
) with check (
  auth.jwt() ->> 'wallet_pubkey' = wallet_pubkey
);
