-- Global registry (Phase 2). Local Ambassadors SEAL face<->monke associations to the
-- global box PUBLIC key (write-only — they contribute but cannot read); only
-- global_admins hold the secret key and can OPEN + match. A secret cannot live
-- on-chain (everything on-chain is public), so the global secret key is wrapped
-- per global_admin under their wallet-derived KEK (same envelope pattern as the
-- country vault). On-chain may later hold only the membership set + the public key.

-- The single global box keypair. The public key is public (ambassadors seal with it);
-- the secret key never lands here in plaintext — only the public half + provenance.
create table if not exists public.global_registry_key (
  id smallint primary key default 1,
  box_public_key text not null,            -- base64 (nacl.box public key)
  created_by text not null,                -- wallet that initialised the registry
  created_at timestamptz not null default now(),
  constraint global_registry_key_singleton check (id = 1)
);

-- Per-global-admin wrapped copy of the global box SECRET key (AES-256-GCM under that
-- admin's wallet KEK). Only the holder of the wallet can unwrap and read the registry.
create table if not exists public.global_key_grants (
  global_admin_wallet text primary key,
  wrapped_secret text not null,            -- base64 AES-GCM ciphertext of the secret key
  iv text not null,                        -- base64 12-byte GCM IV
  granted_by text not null,                -- wallet that issued this grant (self on init)
  created_at timestamptz not null default now()
);

-- Sealed roster entries. Write-only for ambassadors; readable only by global_admins
-- (who hold the secret key). No PII: the sealed blob is {embedding, monke cutout};
-- country stays plaintext purely for counts/scoping.
create table if not exists public.encrypted_global_registry (
  id uuid primary key default gen_random_uuid(),
  country text,
  sealed_blob text not null,               -- base64 sealed-box of JSON {embedding, monke}
  created_by text not null,                -- contributing ambassador wallet
  created_at timestamptz not null default now()
);

create index if not exists idx_global_registry_country
  on public.encrypted_global_registry (country);

-- RLS on, no policies: only service_role (which bypasses RLS) reaches these tables.
-- The app layer enforces role on every route; RLS is defense-in-depth.
alter table public.global_registry_key enable row level security;
alter table public.global_key_grants enable row level security;
alter table public.encrypted_global_registry enable row level security;

-- New tables aren't auto-exposed in this project; grant the service role explicitly.
grant select, insert, update on public.global_registry_key to service_role;
grant select, insert, update, delete on public.global_key_grants to service_role;
grant select, insert, delete on public.encrypted_global_registry to service_role;
