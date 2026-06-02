-- Seed allowlist (Phase 1/2). Idempotent. Manage via the admin panel afterwards.
--  - 4XqX… , 53awW… = Argentina Local Chapter ambassadors.
--  - AWVn… = DEV super_admin (management/testing; gitignored keypair).
insert into public.allowlist (wallet_pubkey, role, country, added_by, notes) values
  ('4XqXMVeaEx2eactdvVfyu41Ngi6Z2ynRwZJJdQn6ZjGD', 'ambassador',  'AR',  'seed', 'Argentina ambassador'),
  ('53awW6sG3p2VhpZGgrJ7iSSGoyA8B2FsWWdCgeJvC8uy', 'ambassador',  'AR',  'seed', 'Argentina ambassador (2nd)'),
  ('AWVnYJe8kggQHk5ZjrYgyo9CwR6qHKGvUCZXfD1pvVNR', 'super_admin', null,  'seed', 'DEV super_admin (management/testing)')
on conflict (wallet_pubkey) do update
  set role = excluded.role, country = excluded.country, notes = excluded.notes;
