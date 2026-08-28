# Verilog Coder — Supabase SQL Specification

Complete contract for every database object the app relies on, so an LLM can write
the SQL faithfully. Run all files in the **Supabase SQL editor**. **Every file is
idempotent** (`create table if not exists`, `create or replace function`, `drop policy
if exists` before `create policy`) so any file can be re-run safely.

**Run order** (later files depend on earlier ones):
```
1. supabase-schema.sql                 (projects + set_updated_at())
2. supabase-files-migration.sql        (files)
3. supabase-conversations-migration.sql(conversations)
4. backend/billing-schema.sql          (billing tables + credit funcs + signup trigger)
5. backend/billing-freetier.sql        (token free tier; redefines charge_user -> jsonb)
6. backend/anon-freetier.sql           (anonymous tables + funcs)
7. backend/free-credits.sql            (dollar free tier; run LAST)
8. backend/sitewide-cap.sql            (sitewide spend function)
```
> Note the deliberate evolution: `charge_user` is defined 3 times (schema → freetier →
> free-credits). Later definitions win. `billing-freetier.sql` changes its **return
> type** from `bigint` to `jsonb`, so it first does `drop function if exists
> charge_user(uuid,bigint,text,text,int,int)` (Postgres can't `create or replace` a
> function with a changed return type). The final semantics (after all files) are what
> the running app uses — documented per object below.

Conventions used throughout:
- **Money is micros**: `$1.00 = 1_000_000`. The free tier's per-user grant of **$0.85 =
  850000**. Sitewide cap default **$250** (env-overridable; the SQL comment still says
  $500 — the effective cap is the backend env `FREE_TIER_MONTHLY_CAP_USD`).
- Auth user id = `auth.uid()` (Supabase). All user-owned tables cascade on user delete.
- Free-tier accounting **repurposes** columns: after `free-credits.sql`,
  `monthly_token_cap` holds the **dollar grant in micros** and `period_used_tokens`
  holds **real AWS spend so far this month in micros** (names kept for migration ease).

---

## 1. `supabase-schema.sql` — projects + shared trigger fn

```sql
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default 'Untitled',
  code        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_user_id_updated_idx
  on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;
-- Owner-only for all 4 verbs (pattern reused by files + conversations):
--   select/update/delete: using (auth.uid() = user_id)
--   insert/update:        with check (auth.uid() = user_id)
drop policy if exists "select own projects" on public.projects;
create policy "select own projects" on public.projects for select using (auth.uid() = user_id);
drop policy if exists "insert own projects" on public.projects;
create policy "insert own projects" on public.projects for insert with check (auth.uid() = user_id);
drop policy if exists "update own projects" on public.projects;
create policy "update own projects" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own projects" on public.projects;
create policy "delete own projects" on public.projects for delete using (auth.uid() = user_id);

-- Shared trigger fn (reused by files + conversations): keep updated_at fresh.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
```

## 2. `supabase-files-migration.sql` — files (many per project)

```sql
create table if not exists public.files (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default 'untitled.v',
  code        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists files_project_name_idx on public.files (project_id, name);

alter table public.files enable row level security;
-- Same 4 owner-only policies as projects ("... own files"), keyed on auth.uid() = user_id.

drop trigger if exists files_set_updated_at on public.files;
create trigger files_set_updated_at before update on public.files
  for each row execute function public.set_updated_at();

-- One-time migration: turn each legacy project's single `code` into a top.v file.
insert into public.files (project_id, user_id, name, code)
select p.id, p.user_id, 'top.v', coalesce(p.code, '')
from public.projects p
where not exists (select 1 from public.files f where f.project_id = p.id);
```

## 3. `supabase-conversations-migration.sql` — saved AI chats

```sql
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null default 'New chat',
  provider    text,
  model       text,
  messages    jsonb not null default '[]'::jsonb,   -- [{role, content, images?}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists conversations_user_updated_idx on public.conversations (user_id, updated_at desc);

alter table public.conversations enable row level security;
-- Same 4 owner-only policies ("... own conversations").

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();
```

---

## 4. `backend/billing-schema.sql` — billing tables + credit funcs

```sql
create table if not exists billing_accounts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text,
  credit_micros      bigint not null default 0,      -- prepaid balance (micros)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create table if not exists usage_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  kind          text,                                 -- 'chat' | 'build' | 'flow'
  model         text,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cost_micros   bigint not null default 0
);
create index if not exists usage_events_user_time on usage_events (user_id, created_at desc);
create table if not exists credit_topups (
  stripe_event_id text primary key,                   -- dedupe key for Stripe events
  user_id         uuid not null references auth.users(id) on delete cascade,
  amount_micros   bigint not null,
  created_at      timestamptz not null default now()
);

-- RLS: users may READ their own account + usage; NO write policies exist, so only
-- the backend's service_role key (bypasses RLS) can mutate balances.
alter table billing_accounts enable row level security;
alter table usage_events     enable row level security;
alter table credit_topups    enable row level security;
drop policy if exists read_own_acct  on billing_accounts;
drop policy if exists read_own_usage on usage_events;
create policy read_own_acct  on billing_accounts for select using (auth.uid() = user_id);
create policy read_own_usage on usage_events     for select using (auth.uid() = user_id);
-- credit_topups: no read policy (internal only).

-- charge_user (v1: returns bigint balance; REPLACED in billing-freetier.sql).
-- add_credits: idempotent top-up keyed on the Stripe event id.
-- Both SECURITY DEFINER; only the backend calls them.
create or replace function add_credits(p_event text, p_user uuid, p_amount bigint)
returns bigint language plpgsql security definer as $$
declare new_balance bigint;
begin
  insert into credit_topups (stripe_event_id, user_id, amount_micros)
    values (p_event, p_user, p_amount) on conflict (stripe_event_id) do nothing;
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

-- Signup trigger (REDEFINED in free-credits.sql to grant the $0.85 dollar tier).
-- CRITICAL: the final version MUST be exception-safe — a throwing trigger rolls
-- back the whole signup ("Database error saving new user"). See §7.
create or replace function grant_starting_credits() returns trigger
  language plpgsql security definer as $$
begin
  insert into billing_accounts (user_id, credit_micros) values (new.id, 250000)
    on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_billing on auth.users;
create trigger on_auth_user_created_billing
  after insert on auth.users for each row execute function grant_starting_credits();
```

## 5. `backend/billing-freetier.sql` — monthly token tier (transitional)

Adds the monthly-reset columns and redefines the gate functions. (The **dollar**
version in §7 supersedes the accounting, but these functions — `roll_period`,
`can_spend`, `usage_status` — remain the ones the app calls.)

```sql
alter table billing_accounts
  add column if not exists monthly_token_cap  bigint not null default 100000,
  add column if not exists period_used_tokens bigint not null default 0,
  add column if not exists period_month       date   not null default date_trunc('month', now())::date;

-- Roll to the current month (zero the counter) if the stored month is stale.
create or replace function roll_period(p_user uuid) returns void
  language plpgsql security definer as $$
declare this_month date := date_trunc('month', now())::date;
begin
  update billing_accounts set period_month = this_month, period_used_tokens = 0
   where user_id = p_user and period_month < this_month;
end $$;

-- Gate: true while used < cap this month. Ensures the row exists + rolls first.
create or replace function can_spend(p_user uuid) returns boolean
  language plpgsql security definer as $$
declare acct billing_accounts;
begin
  insert into billing_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  perform roll_period(p_user);
  select * into acct from billing_accounts where user_id = p_user;
  return acct.period_used_tokens < acct.monthly_token_cap;
end $$;

-- Status JSON for the badge/account endpoint: {tokens_remaining, monthly_token_cap, tokens_used}.
create or replace function usage_status(p_user uuid) returns jsonb
  language plpgsql security definer as $$
declare acct billing_accounts; tokens_left bigint;
begin
  insert into billing_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  perform roll_period(p_user);
  select * into acct from billing_accounts where user_id = p_user;
  tokens_left := greatest(acct.monthly_token_cap - acct.period_used_tokens, 0);
  return jsonb_build_object('tokens_remaining', tokens_left,
    'monthly_token_cap', acct.monthly_token_cap, 'tokens_used', acct.period_used_tokens);
end $$;

-- Return type changes bigint -> jsonb, so drop the old signature first.
drop function if exists charge_user(uuid, bigint, text, text, int, int);
-- (charge_user is redefined again in free-credits.sql; see §7 for the final body.)
```

## 6. `backend/anon-freetier.sql` — anonymous (no-account) tier

Mirror of the user tier, keyed on a device `anon_id` (uuid from the cookie/localStorage).

```sql
create table if not exists anon_accounts (
  anon_id            uuid primary key,
  monthly_token_cap  bigint not null default 20000,   -- becomes 850000 after free-credits.sql
  period_used_tokens bigint not null default 0,
  period_month       date   not null default date_trunc('month', now())::date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create table if not exists anon_usage_events (
  id            bigint generated always as identity primary key,
  anon_id       uuid not null,
  created_at    timestamptz not null default now(),
  kind          text, model text,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cost_micros   bigint not null default 0
);
-- RLS on, NO policies -> only the backend service_role touches these.
alter table anon_accounts     enable row level security;
alter table anon_usage_events enable row level security;

-- roll_period_anon / can_spend_anon / usage_status_anon: identical logic to the user
-- versions but on anon_accounts, keyed by p_anon uuid. usage_status_anon returns the
-- same {tokens_remaining, monthly_token_cap, tokens_used} JSON shape.
-- charge_anon: accumulate cost + log to anon_usage_events; return usage_status_anon.
-- (Full bodies mirror §5 / §7 with anon_accounts + p_anon.)
```

## 7. `backend/free-credits.sql` — DOLLAR free tier (run LAST)

Switches accounting to real dollars and makes the grant $0.85. `charge_user` /
`charge_anon` now **accumulate the raw AWS micros the backend passes as `p_cost`**
(not token counts). This is the final, authoritative definition of these functions.

```sql
-- Grant = $0.85 (850000 micros); migrate existing rows into the micros unit.
alter table billing_accounts alter column monthly_token_cap set default 850000;
alter table anon_accounts    alter column monthly_token_cap set default 850000;
update billing_accounts set monthly_token_cap = 850000, period_used_tokens = 0;
update anon_accounts    set monthly_token_cap = 850000, period_used_tokens = 0;

-- FINAL charge_user: period_used_tokens += raw AWS micros; log the call; return status.
create or replace function charge_user(p_user uuid, p_cost bigint, p_kind text, p_model text, p_in int, p_out int)
returns jsonb language plpgsql security definer as $$
declare amt bigint := greatest(coalesce(p_cost,0), 0);
begin
  insert into billing_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  perform roll_period(p_user);
  update billing_accounts set period_used_tokens = period_used_tokens + amt, updated_at = now()
   where user_id = p_user;
  insert into usage_events (user_id, kind, model, input_tokens, output_tokens, cost_micros)
    values (p_user, p_kind, p_model, coalesce(p_in,0), coalesce(p_out,0), amt);
  return usage_status(p_user);
end $$;

-- FINAL charge_anon: same, on anon_accounts / anon_usage_events; returns usage_status_anon.
create or replace function charge_anon(p_anon uuid, p_cost bigint, p_kind text, p_model text, p_in int, p_out int)
returns jsonb language plpgsql security definer as $$
declare amt bigint := greatest(coalesce(p_cost,0), 0);
begin
  insert into anon_accounts (anon_id) values (p_anon) on conflict (anon_id) do nothing;
  perform roll_period_anon(p_anon);
  update anon_accounts set period_used_tokens = period_used_tokens + amt, updated_at = now()
   where anon_id = p_anon;
  insert into anon_usage_events (anon_id, kind, model, input_tokens, output_tokens, cost_micros)
    values (p_anon, p_kind, p_model, coalesce(p_in,0), coalesce(p_out,0), amt);
  return usage_status_anon(p_anon);
end $$;

-- FINAL signup trigger: grant the $0.85 dollar tier at account creation.
-- RECOMMENDED HARDENING (prevents "Database error saving new user"): wrap the insert
-- in a nested begin/exception block so ANY failure is swallowed (raise warning) and
-- the signup still succeeds; the backend also lazily creates the row on first use.
create or replace function grant_starting_credits() returns trigger
  language plpgsql security definer as $$
begin
  begin
    insert into billing_accounts (user_id, monthly_token_cap, period_used_tokens, period_month)
      values (new.id, 850000, 0, date_trunc('month', now())::date)
      on conflict (user_id) do nothing;
  exception when others then
    raise warning 'grant_starting_credits skipped: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists on_auth_user_created_billing on auth.users;
create trigger on_auth_user_created_billing
  after insert on auth.users for each row execute function grant_starting_credits();
```

## 8. `backend/sitewide-cap.sql` — monthly sitewide spend

```sql
-- Sum this month's real free-tier AWS spend across BOTH pools (micros). The backend
-- compares this to FREE_TIER_MONTHLY_CAP_USD; over it, NEW free users (tokens_used=0)
-- are blocked ("try next month") while active users continue. Resets monthly by the
-- date_trunc filter.
create or replace function free_tier_spend_micros() returns bigint
  language sql security definer stable as $$
  select
    coalesce((select sum(cost_micros) from usage_events
                where created_at >= date_trunc('month', now())), 0)
  + coalesce((select sum(cost_micros) from anon_usage_events
                where created_at >= date_trunc('month', now())), 0);
$$;
```

---

## 9. What the backend calls (RPC contract summary)

| Backend call (`admin.rpc(...)`) | Returns | Purpose |
| --- | --- | --- |
| `usage_status(p_user)` | jsonb `{tokens_remaining, monthly_token_cap, tokens_used}` (micros) | signed-in badge/account |
| `can_spend(p_user)` | boolean | gate before a signed-in Bedrock call |
| `charge_user(p_user,p_cost,p_kind,p_model,p_in,p_out)` | jsonb status | debit after a call (p_cost = raw AWS micros) |
| `usage_status_anon(p_anon)` | jsonb (same shape) | guest badge |
| `can_spend_anon(p_anon)` | boolean | gate before an anon Bedrock call |
| `charge_anon(p_anon,...)` | jsonb status | debit anon after a call |
| `add_credits(p_event,p_user,p_amount)` | bigint | Stripe top-up (idempotent) |
| `free_tier_spend_micros()` | bigint | sitewide monthly spend for the cap |

Everything the app writes goes through these SECURITY DEFINER functions with the
service_role key; the browser only ever **reads** its own rows via RLS. Optional/unused:
`sync-balances.sql` (`sync_anon`) and `free-tokens-setup.sql` exist in the repo but are
not part of the active path.
