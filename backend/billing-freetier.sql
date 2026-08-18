-- ============================================================================
-- FREE MONTHLY TIER (run AFTER billing-schema.sql, once, in the Supabase SQL editor).
--
-- Each user gets a monthly allowance (default $0.50) that resets on the 1st.
-- A metered call draws from the free allowance FIRST, then from prepaid credits.
-- The owner's AWS account pays for all Bedrock usage; the cap bounds per-user cost.
-- Idempotent: safe to re-run.
-- ============================================================================

-- Per-user monthly free allowance + the current period's usage.
alter table billing_accounts
  add column if not exists monthly_cap_micros bigint not null default 500000,          -- $0.50/mo free
  add column if not exists period_month       date   not null default date_trunc('month', now())::date,
  add column if not exists period_used_micros bigint not null default 0;

-- Roll the period to the current month if it's stale (zeroes the counter).
create or replace function roll_period(p_user uuid) returns void
  language plpgsql security definer as $$
declare this_month date := date_trunc('month', now())::date;
begin
  update billing_accounts
     set period_month = this_month, period_used_micros = 0
   where user_id = p_user and period_month < this_month;
end $$;

-- Can this user make a call right now? True if free allowance remains OR they
-- have prepaid credits. Rolls the period first so a new month frees them up.
create or replace function can_spend(p_user uuid) returns boolean
  language plpgsql security definer as $$
declare acct billing_accounts;
begin
  insert into billing_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  perform roll_period(p_user);
  select * into acct from billing_accounts where user_id = p_user;
  return (acct.period_used_micros < acct.monthly_cap_micros) or (acct.credit_micros > 0);
end $$;

-- Full status for the credits badge / account endpoint (all in micros).
create or replace function usage_status(p_user uuid) returns jsonb
  language plpgsql security definer as $$
declare acct billing_accounts; free_remaining bigint;
begin
  insert into billing_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  perform roll_period(p_user);
  select * into acct from billing_accounts where user_id = p_user;
  free_remaining := greatest(acct.monthly_cap_micros - acct.period_used_micros, 0);
  return jsonb_build_object(
    'free_remaining_micros', free_remaining,
    'monthly_cap_micros',    acct.monthly_cap_micros,
    'period_used_micros',    acct.period_used_micros,
    'credit_micros',         acct.credit_micros,
    'remaining_micros',      free_remaining + acct.credit_micros
  );
end $$;

-- Charge a completed call: draw from the free monthly allowance first, then from
-- prepaid credits. Returns the post-charge status (same shape as usage_status).
-- Replaces the prepaid-only charge_user from billing-schema.sql.
drop function if exists charge_user(uuid, bigint, text, text, int, int);
create or replace function charge_user(
  p_user uuid, p_cost bigint, p_kind text, p_model text, p_in int, p_out int
) returns jsonb language plpgsql security definer as $$
declare
  acct billing_accounts; free_remaining bigint; from_free bigint; from_credit bigint;
begin
  insert into billing_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  perform roll_period(p_user);
  select * into acct from billing_accounts where user_id = p_user for update;

  free_remaining := greatest(acct.monthly_cap_micros - acct.period_used_micros, 0);
  from_free   := least(free_remaining, p_cost);
  from_credit := p_cost - from_free;                 -- overflow beyond the free cap

  update billing_accounts
     set period_used_micros = period_used_micros + from_free,
         credit_micros      = credit_micros - from_credit,
         updated_at         = now()
   where user_id = p_user;

  insert into usage_events (user_id, kind, model, input_tokens, output_tokens, cost_micros)
    values (p_user, p_kind, p_model, p_in, p_out, p_cost);

  return usage_status(p_user);
end $$;
