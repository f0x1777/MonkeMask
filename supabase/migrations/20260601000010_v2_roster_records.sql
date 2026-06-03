-- Per-record roster storage (replaces the single per-chapter blob).
--
-- The old model encrypted the WHOLE roster into one row and overwrote it on every save,
-- so concurrent saves clobbered each other (last-write-wins) and you couldn't delete a
-- single person. Now each face<->monke is its own encrypted row: saves are independent
-- (no clobber), and resetting a person who sold/changed their monke is a single DELETE.
--
-- person_id is an opaque client uuid (no PII); the embedding + monke stay encrypted in
-- ciphertext under the chapter CK. The server only ever sees counts.
create table if not exists public.encrypted_roster_records (
  id uuid primary key default gen_random_uuid(),
  country text not null,                    -- chapter code
  person_id text not null,                  -- opaque uuid (for upsert + reset by person)
  key_version int not null default 1,
  ciphertext text not null,                 -- AES-GCM of {embedding, monke} under the CK
  iv text not null,
  created_by text not null,
  updated_at timestamptz not null default now(),
  unique (country, person_id)
);
create index if not exists idx_roster_records_country on public.encrypted_roster_records (country);

alter table public.encrypted_roster_records enable row level security;
grant select, insert, update, delete on public.encrypted_roster_records to service_role;
