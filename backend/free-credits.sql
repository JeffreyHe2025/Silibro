-- ============================================================================
-- DOLLAR-BASED FREE TIER — each user (signed-in + anonymous) gets a fixed
-- monthly free-CREDIT amount (default $0.85) they can spend on ANY Bedrock model.
-- This caps the owner's real AWS cost PER USER regardless of model choice.
--
-- Implementation note: to reuse the existing monthly-reset plumbing, the columns
-- monthly_token_cap / period_used_tokens now hold MICROS ($1 = 1,000,000), NOT
-- token counts:
--     monthly_token_cap  = the monthly free-credit grant, in micros  (850000 = $0.85)
--     period_used_tokens = real AWS spend so far this month, in micros
-- can_spend / usage_status / roll_period are unchanged (they compare the two).
-- charge_* now accumulate the RAW AWS cost the backend passes (p_cost), not tokens.
-- Idempotent. Run AFTER billing-freetier.sql + anon-freetier.sql.
-- ============================================================================

-- ---- Grant = $0.85/month; migrate existing rows into the new (micros) unit ----
alter table billing_accounts alter column monthly_token_cap set default 850000;
alter table anon_accounts    alter column monthly_token_cap set default 850000;
-- Reset everyone into the new unit (old values were token counts, not micros).
update billing_accounts set monthly_token_cap = 850000, period_used_tokens = 0;
update anon_accounts    set monthly_token_cap = 850000, period_used_tokens = 0;

-- ---- charge_user: accumulate the RAW AWS cost (micros), not token count -------
create or replace function charge_user(
  p_user uuid, p_cost bigint, p_kind text, p_model text, p_in int, p_out int
) returns jsonb language plpgsql security definer as $$
declare amt bigint := greatest(coalesce(p_cost,0), 0);  -- raw AWS micros this call
begin
  insert into billing_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  perform roll_period(p_user);
  update billing_accounts
     set period_used_tokens = period_used_tokens + amt, updated_at = now()
   where user_id = p_user;
  insert into usage_events (user_id, kind, model, input_tokens, output_tokens, cost_micros)
    values (p_user, p_kind, p_model, coalesce(p_in,0), coalesce(p_out,0), amt);
  return usage_status(p_user);
end $$;

-- ---- charge_anon: same, for anonymous accounts -------------------------------
create or replace function charge_anon(
  p_anon uuid, p_cost bigint, p_kind text, p_model text, p_in int, p_out int
) returns jsonb language plpgsql security definer as $$
declare amt bigint := greatest(coalesce(p_cost,0), 0);
begin
  insert into anon_accounts (anon_id) values (p_anon) on conflict (anon_id) do nothing;
  perform roll_period_anon(p_anon);
  update anon_accounts
     set period_used_tokens = period_used_tokens + amt, updated_at = now()
   where anon_id = p_anon;
  insert into anon_usage_events (anon_id, kind, model, input_tokens, output_tokens, cost_micros)
    values (p_anon, p_kind, p_model, coalesce(p_in,0), coalesce(p_out,0), amt);
  return usage_status_anon(p_anon);
end $$;

-- The signup trigger already inserts a billing_accounts row; it now inherits the
-- 850000-micro ($0.85) default. free_tier_spend_micros() (sitewide) sums the
-- cost_micros we log above = real AWS spend this month.

-- ---- Signup trigger: grant $0.85 (850000 micros) at account creation ----------
-- (Supersedes the token-era grant in free-tokens-setup.sql. Run this file LAST.)
create or replace function grant_starting_credits() returns trigger
  language plpgsql security definer as $$
begin
  insert into billing_accounts (user_id, monthly_token_cap, period_used_tokens, period_month)
    values (new.id, 850000, 0, date_trunc('month', now())::date)
    on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_billing on auth.users;
create trigger on_auth_user_created_billing
  after insert on auth.users
  for each row execute function grant_starting_credits();
