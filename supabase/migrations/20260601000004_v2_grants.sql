-- The project was created with "Automatically expose new tables" OFF, so v2 tables
-- got no PostgREST grants. All v2 access is server-side via the service_role client
-- (which bypasses RLS but still needs table privileges), so grant it explicitly.
-- anon/authenticated get nothing (no client-direct access). The append-only triggers
-- on audit_log / consent_records still block UPDATE/DELETE regardless of these grants.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
