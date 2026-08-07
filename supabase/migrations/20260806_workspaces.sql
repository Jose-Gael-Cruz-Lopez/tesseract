-- Cloud sync for the Knowledge workspace (src/data/sync.js): one row per user
-- holding the whole workspace snapshot (the exportWorkspace() shape, minus its
-- file envelope). Last-write-wins on the whole blob — updated_at is the client
-- push stamp the sync layer compares against local edit times.
--
-- Apply in the Supabase project this app's VITE_SUPABASE_URL points at:
-- either `supabase db push` with the CLI linked to the project, or paste this
-- file into the dashboard's SQL editor and run it. Until it is applied, the
-- app degrades gracefully: sync's initial pull errors, so it stays inert
-- ('offline') and the workspace remains local-only, exactly as before.

create table if not exists public.workspaces (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;

-- RLS: every operation is scoped to the caller's own row. The client reads
-- with an unfiltered select (maybeSingle) and relies on these policies.
create policy "own row select" on public.workspaces
  for select using ((select auth.uid()) = user_id);
create policy "own row insert" on public.workspaces
  for insert with check ((select auth.uid()) = user_id);
create policy "own row update" on public.workspaces
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete policy: the app never deletes the row; account deletion cascades
-- from auth.users.
