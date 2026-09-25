# Meera draft bot (Skinstinct case study)

A Telegram bot that takes Meera's transcribed voice-note fragments, screens them, and returns a LinkedIn **draft** in her voice for her to review. It has no way to publish or schedule anything. The only thing it can do is reply in her Telegram chat.

## Pipeline

| Stage | Where | What happens |
|---|---|---|
| Trigger | Telegram → `api/telegram.js` | Webhook checks Telegram's secret header, returns 200 straight away, and keeps working in the background (`waitUntil`) |
| Input | `lib/bot.js` | Only chats listed in `ALLOWED_CHAT_IDS` get processed. Text notes only (voice notes arrive already transcribed) |
| Context | `context/voice-skill.txt`, `context/published/*.txt` | Voice profile, plus any published pieces added for grounding |
| Screen | `lib/pipeline.js → screenNote` | Gemini scores the note 1–10 against a strict rubric (structured JSON). Anything below `PASS_SCORE` (default 6), sales-led, or needing invented facts is sent back with what's missing |
| Angle | `findAngle` | Gemini with Google Search grounding finds one current news or data item. It's only used if Search actually returned results, and the source links come from the grounding metadata, not from model-written text |
| Draft | `writeDraft` | Gemini drafts with the voice profile as the system prompt. Facts are limited to the note, the sourced angle, and her profile. Any gap becomes a `[CHECK: …]` placeholder |
| Check | `lib/checks.js` | Code-based voice lint (emoji, hashtags, `!`, banned words, CTAs, question openers) triggers one revision pass. Every figure in the draft that isn't in the note or source is flagged |
| Output | `lib/format.js` | Two messages: a review sheet headed **DRAFT: WAITING FOR YOUR REVIEW** (score, angle and sources, things to check), then the post text on its own so it copies cleanly |
| Store | `lib/store.js` | Upstash Redis on Vercel (`KV_REST_API_*`), or `drafts/*.json` when run locally. `/drafts` and `/draft <id>` read drafts back |

`test/no-publish.test.js` fails if code gains a LinkedIn API call, a scheduler, or a Vercel cron.

## Setup

```bash
npm install
cp .env.example .env   # then fill in TELEGRAM_BOT_TOKEN and GEMINI_API_KEY
npm test               # offline tests
npm run models         # confirm which Gemini models your key can use
npm run try -- samples/strong-note.txt
npm run try -- samples/thin-note.txt     # should be rejected
```

## Deploy

```bash
npx vercel link
npx vercel env add TELEGRAM_BOT_TOKEN production    # repeat for GEMINI_API_KEY, TELEGRAM_WEBHOOK_SECRET, ALLOWED_CHAT_IDS
npx vercel --prod
npm run webhook:set -- https://<your-deployment>.vercel.app
npm run webhook:info
```

The first message from a chat that isn't on the allow-list gets that chat's id back (only while `ALLOWED_CHAT_IDS` is empty). Put the id in the env var and redeploy.

For draft storage on Vercel, add Upstash Redis from the Vercel Marketplace (Storage tab). It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you. Without it, the Telegram message is the only copy of a draft.
