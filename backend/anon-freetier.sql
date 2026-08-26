-- ============================================================================
-- ANONYMOUS (no-account) FREE TIER — tracked by a signed httpOnly cookie, NOT
-- by IP (so a whole school/office behind one NAT is NOT one shared quota).
-- Each browser gets its own anon_id (a uuid the backend mints + stores in the
-- cookie) with a small monthly token allowance. The owner's AWS account pays for
-- all Bedrock usage. Idempotent; run in Supabase → SQL editor.
-- ============================================================================

-- One row per anonymous browser (identified by the cookie's anon_id).
create table if not exists anon_accounts (
  anon_id            uuid primary key,                 -- random id from the cookie
  monthly_token_cap  bigint not null default 20000,    -- 20k free tokens/month per device
  period_used_tokens bigint not null default 0,
  period_month       date   not null default date_trunc('month', now())::date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Audit log for anonymous usage (optional but handy).
create table if not exists anon_usage_events (
  id            bigint generated always as identity primary key,
  anon_id       uuid not null,
  created_at    timestamptz not null default now(),
  kind          text, model text,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cost_micros   bigint not null default 0
);

-- Only the backend (service_role) ever touches these — RLS on, no policies.
alter table anon_accounts     enable row level security;
alter table anon_usage_events enable row level security;

-- Roll the period to the current month if stale (zeroes the counter).
create or replace function roll_period_anon(p_anon uuid) returns void
  language plpgsql security definer as $$
declare this_month date := date_trunc('month', now())::date;
begin
  update anon_accounts
     set period_month = this_month, period_used_tokens = 0
   where anon_id = p_anon and period_month < this_month;
end $$;

-- Can this browser make a call right now? True while free tokens remain.
create or replace function can_spend_anon(p_anon uuid) returns boolean
  language plpgsql security definer as $$
declare acct anon_accounts;
begin
  insert into anon_accounts (anon_id) values (p_anon) on conflict (anon_id) do nothing;
  perform roll_period_anon(p_anon);
  select * into acct from anon_accounts where anon_id = p_anon;
  return acct.period_used_tokens < acct.monthly_token_cap;
end $$;

-- Status for the guest badge.
create or replace function usage_status_anon(p_anon uuid) returns jsonb
  language plpgsql security definer as $$
declare acct anon_accounts; tokens_left bigint;
begin
  insert into anon_accounts (anon_id) values (p_anon) on conflict (anon_id) do nothing;
  perform roll_period_anon(p_anon);
  select * into acct from anon_accounts where anon_id = p_anon;
  tokens_left := greatest(acct.monthly_token_cap - acct.period_used_tokens, 0);
  return jsonb_build_object(
    'tokens_remaining',  tokens_left,
    'monthly_token_cap', acct.monthly_token_cap,
    'tokens_used',       acct.period_used_tokens
  );
end $$;

-- Charge a completed call in TOKENS (input + output).
create or replace function charge_anon(
  p_anon uuid, p_cost bigint, p_kind text, p_model text, p_in int, p_out int
) returns jsonb language plpgsql security definer as $$
declare tokens bigint := coalesce(p_in,0) + coalesce(p_out,0);
begin
  insert into anon_accounts (anon_id) values (p_anon) on conflict (anon_id) do nothing;
  perform roll_period_anon(p_anon);
  update anon_accounts
     set period_used_tokens = period_used_tokens + tokens, updated_at = now()
   where anon_id = p_anon;
  insert into anon_usage_events (anon_id, kind, model, input_tokens, output_tokens, cost_micros)
    values (p_anon, p_kind, p_model, coalesce(p_in,0), coalesce(p_out,0), p_cost);
  return usage_status_anon(p_anon);
end $$;
