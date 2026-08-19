-- ============================================================================
-- FREE MONTHLY TIER — TOKEN-BASED (run AFTER billing-schema.sql, in the Supabase
-- SQL editor). Each user gets N tokens/month (input+output combined) that reset
-- on the 1st. Model-agnostic: a token is a token, no pricing involved for the
-- free tier. The owner's AWS account pays for all Bedrock usage.
-- Idempotent: safe to re-run (also safe to re-run over the older dollar version).
-- ============================================================================

-- Per-user monthly TOKEN allowance + the current period's token usage.
alter table billing_accounts
  add column if not exists monthly_token_cap  bigint not null default 100000,     -- 100k tokens/mo free
  add column if not exists period_used_tokens bigint not null default 0,
  add column if not exists period_month       date   not null default date_trunc('month', now())::date;

-- Roll the period to the current month if stale (zeroes the token counter).
create or replace function roll_period(p_user uuid) returns void
  language plpgsql security definer as $$
declare this_month date := date_trunc('month', now())::date;
begin
  update billing_accounts
     set period_month = this_month, period_used_tokens = 0
   where user_id = p_user and period_month < this_month;
end $$;

-- Can this user make a call right now? True while free tokens remain this month.
create or replace function can_spend(p_user uuid) returns boolean
  language plpgsql security definer as $$
declare acct billing_accounts;
begin
  insert into billing_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  perform roll_period(p_user);
  select * into acct from billing_accounts where user_id = p_user;
  return acct.period_used_tokens < acct.monthly_token_cap;
end $$;

-- Status for the badge / account endpoint (token counts).
create or replace function usage_status(p_user uuid) returns jsonb
  language plpgsql security definer as $$
declare acct billing_accounts; tokens_left bigint;
begin
  insert into billing_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  perform roll_period(p_user);
  select * into acct from billing_accounts where user_id = p_user;
  tokens_left := greatest(acct.monthly_token_cap - acct.period_used_tokens, 0);
  return jsonb_build_object(
    'tokens_remaining',   tokens_left,
    'monthly_token_cap',  acct.monthly_token_cap,
    'tokens_used',        acct.period_used_tokens
  );
end $$;

-- Charge a completed call in TOKENS (input + output). p_cost/p_model are still
-- logged to usage_events for records, but the gate is purely token count.
drop function if exists charge_user(uuid, bigint, text, text, int, int);
create or replace function charge_user(
  p_user uuid, p_cost bigint, p_kind text, p_model text, p_in int, p_out int
) returns jsonb language plpgsql security definer as $$
declare tokens bigint := coalesce(p_in,0) + coalesce(p_out,0);
begin
  insert into billing_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  perform roll_period(p_user);
  update billing_accounts
     set period_used_tokens = period_used_tokens + tokens, updated_at = now()
   where user_id = p_user;
  insert into usage_events (user_id, kind, model, input_tokens, output_tokens, cost_micros)
    values (p_user, p_kind, p_model, coalesce(p_in,0), coalesce(p_out,0), p_cost);
  return usage_status(p_user);
end $$;
