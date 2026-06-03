-- Harden rekey_chapter per security audit:
--  - REVOKE EXECUTE FROM PUBLIC/anon/authenticated: a SECURITY DEFINER function is
--    EXECUTE-able by PUBLIC by default, so anon could call it via PostgREST RPC and wipe
--    a chapter, bypassing the Next.js auth. Only service_role (the app) may call it.
--  - Assert p_scope == 'chapter:'||p_country (defense-in-depth vs a compromised caller).
--  - pg_advisory_xact_lock(scope): serialize concurrent re-keys for the same chapter so
--    grants/records can't tear into a mismatched state.
create or replace function public.rekey_chapter(
  p_scope text,
  p_country text,
  p_actor text,
  p_grants jsonb,
  p_records jsonb
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v int;
begin
  if p_scope <> 'chapter:' || p_country then
    raise exception 'scope/country mismatch: % vs %', p_scope, p_country;
  end if;
  -- serialize re-keys for this scope (released at transaction end)
  perform pg_advisory_xact_lock(hashtext(p_scope));

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

revoke execute on function public.rekey_chapter(text, text, text, jsonb, jsonb) from public;
revoke execute on function public.rekey_chapter(text, text, text, jsonb, jsonb) from anon, authenticated;
grant execute on function public.rekey_chapter(text, text, text, jsonb, jsonb) to service_role;
