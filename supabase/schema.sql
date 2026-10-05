-- Kör hela den här filen en gång i Supabase → SQL Editor.

create table if not exists players (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 30),
  created_at timestamptz not null default now()
);
create unique index if not exists players_name_unique on players (lower(name));

create table if not exists matches (
  id uuid primary key,
  status text not null check (status in ('active', 'finished')),
  mode int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists matches_created_idx on matches (created_at desc);

-- Appen är öppen för alla som har länken (ingen inloggning), så anon-rollen får läsa/skriva.
alter table players enable row level security;
alter table matches enable row level security;

drop policy if exists "alla kan allt - players" on players;
drop policy if exists "alla kan allt - matches" on matches;
create policy "alla kan allt - players" on players for all to anon using (true) with check (true);
create policy "alla kan allt - matches" on matches for all to anon using (true) with check (true);

-- Ger anon-rollen behörighet till tabellerna (behövs om "Automatically expose new tables" är avstängt).
grant usage on schema public to anon;
grant select, insert, update, delete on players, matches to anon;
