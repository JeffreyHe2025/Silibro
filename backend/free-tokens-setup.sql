-- ============================================================================
-- FREE TOKENS ON SIGNUP — make sure every new account can use Bedrock with its
-- monthly free token allowance the instant it's created. Idempotent; safe to
-- re-run. Run in Supabase → SQL editor.
--
-- PREREQUISITE: run billing-schema.sql and billing-freetier.sql first — they
-- create the billing_accounts table and the token functions (can_spend /
-- usage_status / charge_user) that the Bedrock gate uses. This script only
-- guarantees provisioning + backfill on top of them.
-- ============================================================================

-- How many free tokens each account gets per month. Change to taste.
-- (Must match the intended default in billing-freetier.sql.)
do $$ begin
  execute 'alter table billing_accounts alter column monthly_token_cap set default 100000';
exception when undefined_column then
  raise notice 'monthly_token_cap missing — run billing-freetier.sql first';
end $$;

-- Belt-and-suspenders: ensure the token columns exist even if billing-freetier
-- was only partially applied.
alter table billing_accounts
  add column if not exists monthly_token_cap  bigint not null default 100000,
  add column if not exists period_used_tokens bigint not null default 0,
  add column if not exists period_month       date   not null default date_trunc('month', now())::date;

-- ---- Provision the free TOKEN tier at signup (replaces the legacy $0.25 grant) ----
-- Fires on auth.users insert = the moment the account is created (before email
-- confirmation), so the free tokens exist immediately.
create or replace function grant_starting_credits() returns trigger
  language plpgsql security definer as $$
begin
  insert into billing_accounts (user_id, monthly_token_cap, period_used_tokens, period_month)
    values (new.id, 100000, 0, date_trunc('month', now())::date)
    on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_billing on auth.users;
create trigger on_auth_user_created_billing
  after insert on auth.users
  for each row execute function grant_starting_credits();

-- ---- Backfill: give every EXISTING user a row if they don't have one ----------
insert into billing_accounts (user_id, monthly_token_cap, period_used_tokens, period_month)
  select u.id, 100000, 0, date_trunc('month', now())::date
    from auth.users u
    left join billing_accounts b on b.user_id = u.id
   where b.user_id is null;

-- ---- Verify: how many users, how many provisioned, and a sample status --------
select
  (select count(*) from auth.users)                                    as total_users,
  (select count(*) from billing_accounts)                              as provisioned_accounts,
  (select count(*) from billing_accounts where monthly_token_cap > 0)  as with_free_tokens;
