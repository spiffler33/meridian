-- Tower Items: Attention steering for ADHD brains
-- Items are stateful (not date-bound), surfaced by expectation and staleness

create table tower_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,

  -- Core content
  text text not null,

  -- Status: where this item lives in the system
  -- active: ready to work on
  -- waiting: blocked on someone/something
  -- someday: not now, but don't forget
  -- done: completed
  status text not null default 'active'
    check (status in ('active', 'waiting', 'someday', 'done')),

  -- Waiting context (only relevant when status = 'waiting')
  waiting_on text,  -- who or what is blocking

  -- Expectation (not a due date - psychologically different)
  expects_by date,  -- when to resurface/check

  -- Effort estimate (AI-inferred or user-set)
  effort text check (effort in ('quick', 'medium', 'deep')),

  -- Timestamps
  last_touched timestamptz default now(),  -- for staleness sorting
  created_at timestamptz default now(),
  done_at timestamptz  -- when completed
);

-- Index for fast queries by user and status
create index tower_items_user_status_idx on tower_items(user_id, status);

-- Index for surfacing logic (expects_by + last_touched)
create index tower_items_surfacing_idx on tower_items(user_id, expects_by, last_touched);

-- Row Level Security
alter table tower_items enable row level security;

create policy "Users can view own tower items"
  on tower_items for select
  using (auth.uid() = user_id);

create policy "Users can insert own tower items"
  on tower_items for insert
  with check (auth.uid() = user_id);

create policy "Users can update own tower items"
  on tower_items for update
  using (auth.uid() = user_id);

create policy "Users can delete own tower items"
  on tower_items for delete
  using (auth.uid() = user_id);
