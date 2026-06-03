-- Allow the new country_ambassador role on the allowlist (the original CHECK only
-- listed ambassador/global_admin/super_admin, so onboarding a country ambassador failed).
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.allowlist'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%role%in%';
  if c is not null then execute format('alter table public.allowlist drop constraint %I', c); end if;
end $$;

alter table public.allowlist add constraint allowlist_role_check
  check (role in ('ambassador', 'country_ambassador', 'global_admin', 'super_admin'));

-- A country ambassador, like a chapter ambassador, must carry a scope (its country).
alter table public.allowlist drop constraint if exists ambassador_has_country;
alter table public.allowlist add constraint scoped_role_has_country
  check (role not in ('ambassador', 'country_ambassador') or country is not null);
