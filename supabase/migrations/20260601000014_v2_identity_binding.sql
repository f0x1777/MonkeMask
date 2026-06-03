-- Bind each registered encryption identity to its wallet with a signature, so a granter
-- can verify (client-side) that the wallet really signed its pubkey before sealing a key
-- to it — a compromised server can no longer substitute a pubkey at enroll time.
-- Nullable for transition; new registrations require it (the app rejects missing/invalid).
alter table public.member_identities add column if not exists identity_sig text;
alter table public.global_admin_pubkeys add column if not exists identity_sig text;
