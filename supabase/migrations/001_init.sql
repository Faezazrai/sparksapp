-- Sparks: database setup. Run this once in Supabase → SQL Editor.
-- BEFORE RUNNING: replace the two emails at the bottom with yours and hers.

-- Who may use the app, and which side of the map they are.
create table if not exists public.members (
  email text primary key check (email = lower(email)),
  side  text not null unique check (side in ('sj', 'pg'))
);

-- A tiny document store: one JSON document per path (e.g. "people/sj", "shared/meet").
create table if not exists public.kv (
  path       text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Each phone's push subscription.
create table if not exists public.push_subscriptions (
  endpoint     text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  side         text not null check (side in ('sj', 'pg')),
  subscription jsonb not null,
  created_at   timestamptz not null default now()
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = lower(auth.jwt() ->> 'email'));
$$;

alter table public.members enable row level security;
alter table public.kv enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "members read" on public.members;
create policy "members read" on public.members for select to authenticated using (public.is_member());

drop policy if exists "kv read" on public.kv;
drop policy if exists "kv insert" on public.kv;
drop policy if exists "kv update" on public.kv;
drop policy if exists "kv delete" on public.kv;
create policy "kv read"   on public.kv for select to authenticated using (public.is_member());
create policy "kv insert" on public.kv for insert to authenticated with check (public.is_member());
create policy "kv update" on public.kv for update to authenticated using (public.is_member()) with check (public.is_member());
create policy "kv delete" on public.kv for delete to authenticated using (public.is_member());

drop policy if exists "own subs" on public.push_subscriptions;
create policy "own subs" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- Live updates for the document store.
do $$ begin
  alter publication supabase_realtime add table public.kv;
exception when duplicate_object then null; end $$;

-- ✏️ Your two emails (lowercase). sj = Subang Jaya, pg = Pasir Gudang.
insert into public.members (email, side) values
  ('your-email@example.com', 'sj'),
  ('her-email@example.com',  'pg')
on conflict (email) do update set side = excluded.side;
