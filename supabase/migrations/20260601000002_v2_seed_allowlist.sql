-- Seed the initial allowlist (Phase 1). Idempotent. Adjust roles/countries later
-- via the admin panel (Phase 4).
--
--  - 4XqX… = Argentina Local Chapter / operator wallet -> super_admin (bootstraps
--    the allowlist; can add the other ~20-30 ambassadors).
--  - AWVn… = DEV throwaway wallet (gitignored secret) -> ambassador / AR, for
--    exercising the ambassador flow in development.
insert into public.allowlist (wallet_pubkey, role, country, added_by, notes) values
  ('4XqXMVeaEx2eactdvVfyu41Ngi6Z2ynRwZJJdQn6ZjGD', 'super_admin', null, 'seed',
   'Argentina Local Chapter / operator'),
  ('AWVnYJe8kggQHk5ZjrYgyo9CwR6qHKGvUCZXfD1pvVNR', 'ambassador', 'AR', 'seed',
   'DEV throwaway wallet for testing')
on conflict (wallet_pubkey) do update
  set role = excluded.role, country = excluded.country, notes = excluded.notes;
