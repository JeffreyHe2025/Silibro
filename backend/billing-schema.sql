-- ============================================================================
-- Prepaid-credits billing for Verilog Coder (Bedrock provider).
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- Model: each user has a credit balance in "micros" (millionths of a dollar,
-- so $1.00 = 1_000_000). Every metered Bedrock call debits the balance by
-- (tokens x your per-token rate). Users top up via Stripe. They can READ their
-- own balance/usage; only the backend (service_role) can change balances.
-- ============================================================================

-- One row per user: balance + Stripe linkage.
create table if not exists billing_accounts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text,
  credit_micros      bigint not null default 0,   -- balance, in millionths of a dollar
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Immutable log of every metered call (audit trail + support + the usage page).
create table if not exists usage_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  kind          text,          -- 'chat' | 'build' | 'flow'
  model         text,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cost_micros   bigint not null default 0
);
create index if not exists usage_events_user_time on usage_events (user_id, created_at desc);

-- Log of top-ups (so a Stripe event is only ever applied once → idempotency).
create table if not exists credit_topups (
  stripe_event_id text primary key,   -- Stripe event.id; the dedupe key
  user_id         uuid not null references auth.users(id) on delete cascade,
  amount_micros   bigint not null,
  created_at      timestamptz not null default now()
);

-- ---- Row Level Security -----------------------------------------------------
-- Users may READ their own rows. NO insert/update/delete policies exist, so the
-- anon/authenticated client can never mutate balances — only the service_role
-- key (used exclusively by your backend) bypasses RLS.
alter table billing_accounts enable row level security;
alter table usage_events     enable row level security;
alter table credit_topups    enable row level security;

drop policy if exists read_own_acct  on billing_accounts;
drop policy if exists read_own_usage on usage_events;
create policy read_own_acct  on billing_accounts for select using (auth.uid() = user_id);
create policy read_own_usage on usage_events     for select using (auth.uid() = user_id);
-- credit_topups: no read policy (internal only).

-- ---- Atomic debit: charge a call and log it in one transaction ---------------
-- SECURITY DEFINER so it runs with the owner's rights; only the backend calls it.
create or replace function charge_user(
  p_user uuid, p_cost bigint, p_kind text, p_model text, p_in int, p_out int
) returns bigint language plpgsql security definer as $$
declare new_balance bigint;
begin
  insert into billing_accounts (user_id) values (p_user)
    on conflict (user_id) do nothing;
  update billing_accounts
     set credit_micros = credit_micros - p_cost, updated_at = now()
   where user_id = p_user
   returning credit_micros into new_balance;
  insert into usage_events (user_id, kind, model, input_tokens, output_tokens, cost_micros)
    values (p_user, p_kind, p_model, p_in, p_out, p_cost);
  return new_balance;
end $$;

-- ---- Idempotent top-up: add credits for a Stripe payment exactly once --------
create or replace function add_credits(
  p_event text, p_user uuid, p_amount bigint
) returns bigint language plpgsql security definer as $$
declare new_balance bigint;
begin
  -- If we've already processed this Stripe event, do nothing and return balance.
  insert into credit_topups (stripe_event_id, user_id, amount_micros)
    values (p_event, p_user, p_amount)
    on conflict (stripe_event_id) do nothing;
  if not found then
    select credit_micros into new_balance from billing_accounts where user_id = p_user;
    return new_balance;
  end if;
  insert into billing_accounts (user_id, credit_micros) values (p_user, p_amount)
    on conflict (user_id)
    do update set credit_micros = billing_accounts.credit_micros + p_amount, updated_at = now()
    returning credit_micros into new_balance;
  return new_balance;
end $$;

-- ---- Give every new user a small free starting balance ----------------------
-- $0.25 free (250_000 micros) so people can try Bedrock before paying. Change
-- the number (or delete this trigger) to taste.
create or replace function grant_starting_credits() returns trigger
  language plpgsql security definer as $$
begin
  insert into billing_accounts (user_id, credit_micros)
    values (new.id, 250000)
    on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_billing on auth.users;
create trigger on_auth_user_created_billing
  after insert on auth.users
  for each row execute function grant_starting_credits();
