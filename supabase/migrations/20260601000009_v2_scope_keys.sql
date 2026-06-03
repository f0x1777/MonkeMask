-- Race-safe "this scope is initialised" marker. Init must be atomic: two ambassadors
-- signing in at the same instant must not each generate a different CK for the same
-- chapter (split-brain). scope_keys.scope is a PRIMARY KEY, so the first INSERT wins and
-- the concurrent one fails with a unique violation -> the route returns 409. (A unique
-- index on scoped_key_grants(scope,...) can't be used: many holders legitimately share
-- the same scope + key_version.) key_version also anchors re-keying.
create table if not exists public.scope_keys (
  scope text primary key,
  key_version int not null default 1,
  created_by text not null,
  created_at timestamptz not null default now()
);
alter table public.scope_keys enable row level security;
grant select, insert, update, delete on public.scope_keys to service_role;
