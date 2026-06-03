-- Atomic chapter re-key. Rotating the CK touches three tables (supersede old grants,
-- bump the version, insert new grants, re-encrypt every record). Doing it in one
-- SECURITY DEFINER function = one transaction, so a removed member can never be left
-- half-revoked (e.g. records re-encrypted but new grants missing).
--
-- The client computes the new sealed grants (CK sealed to each remaining holder) and the
-- re-encrypted records (under the new CK) and passes them in; the server never sees the
-- CK or plaintext.
create or replace function public.rekey_chapter(
  p_scope text,
  p_country text,
  p_actor text,
  p_grants jsonb,    -- [{ wallet_pubkey, sealed_key }]
  p_records jsonb    -- [{ person_id, ciphertext, iv }]
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v int;
begin
  update public.scoped_key_grants set superseded_at = now()
    where scope = p_scope and superseded_at is null;

  update public.scope_keys set key_version = key_version + 1
    where scope = p_scope
    returning key_version into v;
  if v is null then
    raise exception 'scope % is not initialised', p_scope;
  end if;

  insert into public.scoped_key_grants (wallet_pubkey, scope, key_version, sealed_key, granted_by)
    select g->>'wallet_pubkey', p_scope, v, g->>'sealed_key', p_actor
    from jsonb_array_elements(p_grants) as g;

  update public.encrypted_roster_records r
    set ciphertext = x->>'ciphertext', iv = x->>'iv', key_version = v, updated_at = now()
    from jsonb_array_elements(p_records) as x
    where r.country = p_country and r.person_id = x->>'person_id';

  return v;
end;
$$;

grant execute on function public.rekey_chapter(text, text, text, jsonb, jsonb) to service_role;
