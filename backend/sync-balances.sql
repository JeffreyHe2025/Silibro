-- ============================================================================
-- RECONCILE signed-in and signed-out free-credit pools for the same person/device.
-- A user has a billing_accounts row (by user id) and a device has an anon_accounts
-- row (by cookie/localStorage id). sync_anon() sets BOTH period_used_tokens to the
-- MAX of the two, so switching sign-in state can't refill (or lose) credit and both
-- views show the same balance. Called whenever a signed-in user's balance is read
-- (the frontend forwards its X-Anon-Id). Idempotent; run in Supabase SQL editor.
-- (Requires billing-freetier.sql + anon-freetier.sql + free-credits.sql first.)
-- ============================================================================
create or replace function sync_anon(p_user uuid, p_anon uuid) returns jsonb
  language plpgsql security definer as $$
declare m bigint;
begin
  insert into billing_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  perform roll_period(p_user);
  insert into anon_accounts (anon_id) values (p_anon) on conflict (anon_id) do nothing;
  perform roll_period_anon(p_anon);

  -- higher usage wins (spent-so-far can only go up within a month)
  select greatest(
           coalesce((select period_used_tokens from billing_accounts where user_id = p_user), 0),
           coalesce((select period_used_tokens from anon_accounts    where anon_id = p_anon), 0)
         ) into m;

  update billing_accounts set period_used_tokens = m, updated_at = now() where user_id = p_user;
  update anon_accounts     set period_used_tokens = m, updated_at = now() where anon_id = p_anon;

  return usage_status(p_user);
end $$;
