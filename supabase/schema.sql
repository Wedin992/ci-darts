-- Kör hela den här filen i Supabase → SQL Editor. Den går att köra flera gånger (den ändrar inget som redan finns).
-- Funkar både för en helt ny databas och som uppdatering av en befintlig (lägger till "hem").

-- ---------- Hem ----------
create table if not exists homes (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index if not exists homes_name_unique on homes (lower(name));
-- Det ursprungliga hemmet "Ci" – all befintlig data hamnar här.
insert into homes (id, name) values ('00000000-0000-4000-8000-000000000001', 'Ci') on conflict (id) do nothing;

-- ---------- Spelare ----------
create table if not exists players (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 30),
  created_at timestamptz not null default now()
);
alter table players add column if not exists home_id uuid references homes(id) default '00000000-0000-4000-8000-000000000001';
update players set home_id = '00000000-0000-4000-8000-000000000001' where home_id is null;
-- Samma namn får finnas i olika hem, men inte två gånger i samma hem.
drop index if exists players_name_unique;
create unique index if not exists players_home_name_unique on players (home_id, lower(name));

-- ---------- Matcher ----------
create table if not exists matches (
  id uuid primary key,
  status text not null check (status in ('active', 'finished')),
  mode int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null
);
alter table matches add column if not exists home_id uuid references homes(id) default '00000000-0000-4000-8000-000000000001';
update matches set home_id = '00000000-0000-4000-8000-000000000001' where home_id is null;
create index if not exists matches_created_idx on matches (created_at desc);
create index if not exists matches_home_idx on matches (home_id, created_at desc);

-- ---------- Behörigheter ----------
-- Appen är öppen för alla som har länken (ingen inloggning), så anon-rollen får läsa/skriva.
alter table homes enable row level security;
alter table players enable row level security;
alter table matches enable row level security;

drop policy if exists "alla kan allt - homes" on homes;
drop policy if exists "alla kan allt - players" on players;
drop policy if exists "alla kan allt - matches" on matches;
create policy "alla kan allt - homes" on homes for all to anon using (true) with check (true);
create policy "alla kan allt - players" on players for all to anon using (true) with check (true);
create policy "alla kan allt - matches" on matches for all to anon using (true) with check (true);

-- Behövs om "Automatically expose new tables" är avstängt.
grant usage on schema public to anon;
grant select, insert, update, delete on homes, players, matches to anon;
