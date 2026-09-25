-- Drafts awaiting Meera's review. Written and read only by the telegram edge function
-- (secret key); RLS is on with no policies, so the publishable key can't touch it.
create table if not exists public.drafts (
  id          text primary key,
  chat_id     text not null,
  status      text not null default 'awaiting_review',
  created_at  timestamptz not null default now(),
  score       int,
  core_idea   text,
  record      jsonb not null
);
create index if not exists drafts_chat_created on public.drafts (chat_id, created_at desc);
alter table public.drafts enable row level security;

-- Telegram update ids already handled, so a redelivered webhook doesn't draft twice.
create table if not exists public.telegram_updates (
  update_id    bigint primary key,
  received_at  timestamptz not null default now()
);
alter table public.telegram_updates enable row level security;
