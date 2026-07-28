-- Run this ONCE in Supabase (SQL Editor -> New query -> paste -> Run) to add
-- saved AI chat history. Each conversation belongs to a user and stores its
-- messages as JSON. Safe to re-run.

create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null default 'New chat',
  provider    text,
  model       text,
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);

alter table public.conversations enable row level security;

drop policy if exists "select own conversations" on public.conversations;
create policy "select own conversations"
  on public.conversations for select
  using (auth.uid() = user_id);

drop policy if exists "insert own conversations" on public.conversations;
create policy "insert own conversations"
  on public.conversations for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own conversations" on public.conversations;
create policy "update own conversations"
  on public.conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own conversations" on public.conversations;
create policy "delete own conversations"
  on public.conversations for delete
  using (auth.uid() = user_id);

-- Reuse the set_updated_at() function created in supabase-schema.sql.
drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();
