-- Run this ONCE, after supabase-schema.sql, to add multi-file support.
--   Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Adds a "files" table (many files per project) and migrates any existing
-- single-file projects so their old code becomes a file named "top.v".

create table if not exists public.files (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default 'untitled.v',
  code        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists files_project_name_idx
  on public.files (project_id, name);

alter table public.files enable row level security;

drop policy if exists "select own files" on public.files;
create policy "select own files"
  on public.files for select
  using (auth.uid() = user_id);

drop policy if exists "insert own files" on public.files;
create policy "insert own files"
  on public.files for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own files" on public.files;
create policy "update own files"
  on public.files for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own files" on public.files;
create policy "delete own files"
  on public.files for delete
  using (auth.uid() = user_id);

-- Reuse the set_updated_at() function created in supabase-schema.sql.
drop trigger if exists files_set_updated_at on public.files;
create trigger files_set_updated_at
  before update on public.files
  for each row execute function public.set_updated_at();

-- Migrate existing single-file projects: turn each project's old "code" into a
-- file. Safe to re-run — it skips projects that already have files.
insert into public.files (project_id, user_id, name, code)
select p.id, p.user_id, 'top.v', coalesce(p.code, '')
from public.projects p
where not exists (
  select 1 from public.files f where f.project_id = p.id
);
