-- Add is_event column to tower_items
-- false = action (something you DO) - surfaces by deadline/staleness
-- true = event (something you SHOW UP to) - surfaces as reminder day-before/day-of

alter table tower_items
  add column is_event boolean not null default false;

-- Add comment for documentation
comment on column tower_items.is_event is
  'false = action (DO it, deadline), true = event (SHOW UP, reminder)';
