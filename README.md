# Meera draft bot (Skinstinct case study)

A Telegram bot that takes Meera's transcribed voice-note fragments, screens them, and returns a LinkedIn **draft** in her voice for her to review. It has no way to publish or schedule anything. The only thing it can do is reply in her Telegram chat.

## How it runs

There is no server. The backend is a scheduled GitHub Actions workflow in a **private** repo ([.github/workflows/poll.yml](.github/workflows/poll.yml)):

1. Every 30 minutes (or on demand with **Run workflow**), `scripts/poll.js` fetches new posts from Telegram with `getUpdates`.
2. Each note goes through the pipeline below and the replies land in the chat, threaded under the note.
3. Drafts are written to `drafts/*.json` and the workflow commits them, so the repo is the review history.

Telegram is the only interface. The only way Meera sees or retrieves drafts is in chat (`/drafts`, `/draft <id>`).

Why 30 minutes: private repos get 2,000 free Actions minutes/month and every run bills at least a minute. Every 30 minutes is about 1,440 min/month. Change the cron if your plan allows more.

## Pipeline

| Stage | Where | What happens |
|---|---|---|
| Trigger | `scripts/poll.js` | Picks up `message` and `channel_post` updates, confirms each after handling so nothing is drafted twice |
| Input | `lib/bot.js` | Only chats in `ALLOWED_CHAT_IDS` are processed (Meera's private "My notes" channel). Text only; voice notes arrive already transcribed |
| Context | `context/voice-skill.txt`, `context/published/*.txt` | Voice profile, plus any published pieces added for grounding |
| Screen | `lib/pipeline.js → screenNote` | Gemini scores the note 1–10 against a strict rubric (structured JSON). Below `PASS_SCORE` (default 6), sales-led, or needing invented facts → sent back with what's missing |
| Angle | `findAngle` | Gemini + Google Search grounding finds one current news/data item. Used only if Search actually returned results; source links come from grounding metadata, not model-typed text |
| Draft | `writeDraft` | Gemini drafts with the voice profile as system prompt. Facts limited to the note, the sourced angle, and her profile; claims can't be made stronger than in the note; gaps become `[CHECK: …]` placeholders |
| Check | `lib/checks.js` | Code-based voice lint (emoji, hashtags, `!`, banned words, CTAs, question openers) triggers one revision; any figure not in the note or source is flagged |
| Output | `lib/format.js` | Review sheet headed **DRAFT: WAITING FOR YOUR REVIEW** (score, angle + sources, things to check), then the post on its own so it copies cleanly |

Models: screening and search on `gemini-3.7-flash`, drafting on `gemini-3.8-flash`, falling back through other 3.x Flash models on overload or an exhausted daily quota.

`test/no-publish.test.js` fails if code gains a LinkedIn or posting-tool call, any outbound host other than Telegram, or a workflow step beyond the poller.

## Setup

```bash
npm install
cp .env.example .env     # fill in TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, ALLOWED_CHAT_IDS
npm test
npm run try -- samples/strong-note.txt   # pipeline only, no Telegram
npm run poll                             # one real pass against Telegram
```

## Deploy (GitHub)

```bash
gh repo create meera-draft-bot --private --source . --push
gh secret set -f .env     # uploads the .env values as Actions secrets; .env itself is never committed
gh workflow run poll-notes
```
