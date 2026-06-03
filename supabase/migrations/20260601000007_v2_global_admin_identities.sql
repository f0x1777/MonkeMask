-- Redesign global key distribution (replaces the symmetric per-admin wrap + handshake).
--
-- Each global_admin derives an X25519 "encryption identity" deterministically from a
-- wallet signature (the wallet only signs; the keypair is derived from that signature)
-- and registers its PUBLIC key here. The global box SECRET key is then SEALED to each
-- admin's enc pubkey (anonymous public-key crypto, nacl.box). Granting a new admin is
-- just "seal the secret to their registered pubkey" — no interactive handshake, and the
-- super_admin still never holds the secret.

-- Per-admin encryption public keys (derived from each admin's wallet signature).
create table if not exists public.global_admin_pubkeys (
  global_admin_wallet text primary key,
  enc_public_key text not null,            -- base64 X25519 (nacl.box) public key
  created_at timestamptz not null default now()
);
alter table public.global_admin_pubkeys enable row level security;
grant select, insert, update, delete on public.global_admin_pubkeys to service_role;

-- Grants now hold the global secret SEALED to the admin's enc pubkey (no symmetric
-- wrap / iv). The tables are empty, so reshape the columns in place.
alter table public.global_key_grants drop column if exists wrapped_secret;
alter table public.global_key_grants drop column if exists iv;
alter table public.global_key_grants add column if not exists sealed_secret text not null default '';
alter table public.global_key_grants alter column sealed_secret drop default;
