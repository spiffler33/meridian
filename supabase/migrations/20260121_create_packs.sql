-- Packs: Finite counters with optional session notes
-- Track things like "12/48 trainer sessions used"

create table packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  -- Core
  label text not null,
  total integer not null check (total > 0),

  -- Timestamps
  created_at timestamptz default now(),
  archived_at timestamptz  -- soft delete
);

-- Index for fast queries by user
create index packs_user_idx on packs(user_id);

-- Row Level Security
alter table packs enable row level security;

create policy "Users can view own packs"
  on packs for select
  using (auth.uid() = user_id);

create policy "Users can insert own packs"
  on packs for insert
  with check (auth.uid() = user_id);

create policy "Users can update own packs"
  on packs for update
  using (auth.uid() = user_id);

create policy "Users can delete own packs"
  on packs for delete
  using (auth.uid() = user_id);


-- Pack Sessions: Individual sessions within a pack
create table pack_sessions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid references packs(id) on delete cascade not null,

  -- Session details
  date date not null,
  note text,  -- optional note like "Deadlift PR 80kg"

  -- Timestamp
  created_at timestamptz default now()
);

-- Index for fast queries by pack
create index pack_sessions_pack_idx on pack_sessions(pack_id);
create index pack_sessions_date_idx on pack_sessions(pack_id, date);

-- Row Level Security
alter table pack_sessions enable row level security;

-- Sessions inherit access from their pack's user_id
create policy "Users can view own pack sessions"
  on pack_sessions for select
  using (
    exists (
      select 1 from packs
      where packs.id = pack_sessions.pack_id
      and packs.user_id = auth.uid()
    )
  );

create policy "Users can insert own pack sessions"
  on pack_sessions for insert
  with check (
    exists (
      select 1 from packs
      where packs.id = pack_sessions.pack_id
      and packs.user_id = auth.uid()
    )
  );

create policy "Users can update own pack sessions"
  on pack_sessions for update
  using (
    exists (
      select 1 from packs
      where packs.id = pack_sessions.pack_id
      and packs.user_id = auth.uid()
    )
  );

create policy "Users can delete own pack sessions"
  on pack_sessions for delete
  using (
    exists (
      select 1 from packs
      where packs.id = pack_sessions.pack_id
      and packs.user_id = auth.uid()
    )
  );
