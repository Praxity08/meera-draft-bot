-- Outcome log written by the telegram edge function, one row per step that matters.
-- A 'received' row with no later outcome for the same update means the worker was cut off.
create table if not exists public.bot_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  update_id  bigint,
  event      text not null,
  detail     text
);
create index if not exists bot_events_at on public.bot_events (at desc);
alter table public.bot_events enable row level security;
