# Meera draft bot (Skinstinct case study)

A Telegram bot that takes Meera's transcribed voice-note fragments, screens them, and returns a LinkedIn **draft** in her voice for her to review. It has no way to publish or schedule anything. The only thing it can do is reply in her Telegram chat.

## How it runs

The backend is a **Supabase Edge Function** ([supabase/functions/telegram/index.js](supabase/functions/telegram/index.js)) registered as the bot's Telegram webhook. Posting a note in the channel triggers it immediately:

1. Telegram calls the function. It checks Telegram's secret header, acknowledges straight away, and keeps working in the background.
2. The note goes through the pipeline below. Replies land in the chat, threaded under the note, usually within a minute.
3. Drafts are saved to the `drafts` table in Supabase Postgres ([migration](supabase/migrations/20260925000000_drafts.sql)). `telegram_updates` records handled update ids so a redelivered webhook never drafts twice. Both tables have RLS on with no policies, so only the function's secret key can read them.

Telegram is the only interface. Meera sees and retrieves drafts only in chat (`/drafts`, `/draft <id>`).

Free-plan limits to know about: each call has 150s of wall-clock time, and a project with no activity for about a week may be paused (restore it from the Supabase dashboard).

## Pipeline

| Stage | Where | What happens |
|---|---|---|
| Trigger | `supabase/functions/telegram` | Telegram webhook for `message` and `channel_post` updates; duplicates are ignored via `telegram_updates` |
| Input | `lib/bot.js`, `lib/transcribe.js` | Only chats in `ALLOWED_CHAT_IDS` are processed (Meera's private "My notes" channel). Text, voice notes and audio files (up to 20 min). Audio is transcribed verbatim by `gemini-3.5-transcribe` with en-IN/hi-IN/ml-IN hints and her technical vocabulary; replies show a "Heard:" line so mis-hearings are easy to spot |
| Context | `context/voice-skill.txt`, `context/published/*.txt` | Voice profile, plus any published pieces added for grounding |
| Screen | `lib/pipeline.js → screenNote` | Gemini scores the note 1–10 against a strict rubric (structured JSON). Below `PASS_SCORE` (default 6), sales-led, or needing invented facts → sent back with what's missing |
| Angle | `findAngle` | Gemini + Google Search grounding finds one current news/data item. Used only if Search actually returned results; source links come from grounding metadata, not model-typed text |
| Draft | `writeDraft` | Gemini drafts with the voice profile as system prompt. Facts limited to the note, the sourced angle, and her profile; claims can't be made stronger than in the note; gaps become `[CHECK: …]` placeholders |
| Check | `lib/checks.js` | Code-based voice lint (emoji, hashtags, `!`, banned words, CTAs, question openers) triggers one revision; any figure not in the note or source is flagged |
| Output | `lib/format.js` | Review sheet headed **DRAFT: WAITING FOR YOUR REVIEW** (score, angle + sources, things to check), then the post with **Approve / Redraft / Delete** buttons. Approve marks it final (never posts), Redraft writes a different version, Delete (with confirmation) removes the draft and the bot's messages |

Models: screening and search on `gemini-3.7-flash`, drafting on `gemini-3.8-flash`, falling back through other 3.x Flash models on overload or an exhausted daily quota.

`test/no-publish.test.js` fails if code gains a LinkedIn or posting-tool call, a scheduler (GitHub Actions, pg_cron), or any outbound host other than Telegram at runtime.

## Setup

```bash
npm install
cp .env.example .env      # fill in the Telegram, Gemini and Supabase values
npm test
npm run try -- samples/strong-note.txt   # pipeline only; prints the result, saves nothing
```

The voice profile is bundled into the function. After editing anything in `context/`:

```bash
npm run build:context
```

## Deploy (Supabase)

Apply `supabase/migrations/*.sql` once (SQL editor, or the Management API), then:

```bash
npm run deploy        # syncs secrets from .env and uploads the function; no Supabase CLI needed
npm run webhook:set   # points the bot at https://<project-ref>.supabase.co/functions/v1/telegram
npm run webhook:info
```
