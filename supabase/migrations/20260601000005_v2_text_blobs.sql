-- Store wrapped keys + roster ciphertext as base64 text (easier with supabase-js than
-- bytea). Tables are empty, so the encode() cast is a no-op on data.
alter table public.wrapped_keys alter column wrapped_key type text using encode(wrapped_key, 'base64');
alter table public.wrapped_keys alter column iv type text using encode(iv, 'base64');
alter table public.encrypted_country_rosters alter column ciphertext type text using encode(ciphertext, 'base64');
alter table public.encrypted_country_rosters alter column iv type text using encode(iv, 'base64');
