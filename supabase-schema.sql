-- Run this once in your Supabase project:
--   Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Creates a "projects" table and locks it down with Row Level Security so each
-- signed-in user can only read and write their OWN projects.

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default 'Untitled',
  code        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Fast lookups of a user's projects, newest first.
create index if not exists projects_user_id_updated_idx
  on public.projects (user_id, updated_at desc);

-- Turn on Row Level Security.
alter table public.projects enable row level security;

-- Policies: a row is visible/editable only by its owner.
drop policy if exists "select own projects" on public.projects;
create policy "select own projects"
  on public.projects for select
  using (auth.uid() = user_id);

drop policy if exists "insert own projects" on public.projects;
create policy "insert own projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own projects" on public.projects;
create policy "update own projects"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own projects" on public.projects;
create policy "delete own projects"
  on public.projects for delete
  using (auth.uid() = user_id);

-- Keep updated_at fresh on every change.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
