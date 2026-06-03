-- Multi-holder, scoped key distribution. Generalises the global registry's
-- derived-pubkey sealing to every tier: a scope's secret key is SEALED to each holder's
-- X25519 identity (derived from their wallet signature), so several ambassadors of the
-- same chapter share one chapter key (CK), and a country ambassador holds the CKs of
-- every chapter in their country. Re-keying = bump key_version, supersede, re-seal.
--
-- (The global registry keeps its own tables for now — same pattern, unified physically
--  in a later cleanup.)

-- Per-wallet derived encryption identity, reused across scopes (one per wallet).
create table if not exists public.member_identities (
  wallet_pubkey text primary key,
  enc_public_key text not null,            -- base64 X25519 (nacl.box) public key
  created_at timestamptz not null default now()
);

-- A scope's secret sealed to a member's identity. scope is 'chapter:<CODE>' (the CK)
-- — the country tier is a country_ambassador wallet holding a grant per chapter, no
-- separate country key. key_version + superseded_at support re-keying.
create table if not exists public.scoped_key_grants (
  wallet_pubkey text not null,
  scope text not null,
  key_version int not null default 1,
  sealed_key text not null,                -- base64 sealed-box of the scope key
  granted_by text not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (wallet_pubkey, scope, key_version)
);
create index if not exists idx_scoped_grants_active
  on public.scoped_key_grants (scope) where superseded_at is null;

alter table public.member_identities enable row level security;
alter table public.scoped_key_grants enable row level security;
grant select, insert, update, delete on public.member_identities to service_role;
grant select, insert, update, delete on public.scoped_key_grants to service_role;
