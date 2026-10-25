-- =============================================================================
-- Vaidyora — 0005 Helpers callable only by trusted server code (service_role)
-- =============================================================================
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke execute on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;

grant select, insert, update on public.clinic_members to service_role;
