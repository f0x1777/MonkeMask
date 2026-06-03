-- Seed allowlist (Phase 1/2). Idempotent. Manage via the admin panel afterwards.
--  - 53awW… = Argentina chapter super_admin (manages the allowlist).
--  - 4XqX…  = Argentina ambassador (builds the country roster).
--  - AWVn…  = DEV ambassador (testing; gitignored keypair).
insert into public.allowlist (wallet_pubkey, role, country, added_by, notes) values
  ('53awW6sG3p2VhpZGgrJ7iSSGoyA8B2FsWWdCgeJvC8uy', 'super_admin', null, 'seed', 'Argentina chapter — super_admin'),
  ('4XqXMVeaEx2eactdvVfyu41Ngi6Z2ynRwZJJdQn6ZjGD', 'ambassador',  'AR', 'seed', 'Argentina ambassador'),
  ('AWVnYJe8kggQHk5ZjrYgyo9CwR6qHKGvUCZXfD1pvVNR', 'ambassador',  'AR', 'seed', 'DEV ambassador (testing)')
on conflict (wallet_pubkey) do update
  set role = excluded.role, country = excluded.country, notes = excluded.notes;
