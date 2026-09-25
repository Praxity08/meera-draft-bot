Build a Telegram bot, end to end, that turns a skincare founder's (Meera, Skinstinct) voice notes and text fragments into LinkedIn post DRAFTS in her established voice, for her to review. Nothing is ever posted or scheduled automatically: human review is a hard gate, not a config option. Telegram is the only interface.

I will provide: voice-skill.txt (her writing profile), optionally published reference pieces, a Telegram bot token, a Gemini API key (billing enabled), a Supabase project (URL, secret key, personal access token), and a GitHub repo for the code. Keep every credential in a git-ignored .env and in platform secrets; confirm .env is ignored before any commit. Commit and push after each working checkpoint, and stop at each checkpoint for me to confirm.

STACK
- Telegram Bot API. Notes are posted in a private Telegram channel where the bot is an admin, so they arrive as `channel_post` updates (also accept `message`). Button taps arrive as `callback_query`.
- Supabase Edge Function (Deno) as the webhook, plus Supabase Postgres for storage. No other server.
- Gemini via the @google/genai SDK (in Deno: map it with `npm:@google/genai@<version>` in the function's deno.json).
- Plain JavaScript ES modules shared by the function and by local Node scripts/tests. Read env through a helper that tries `Deno.env.get` then `process.env`.

PIPELINE, per note
1. Webhook: check the `X-Telegram-Bot-Api-Secret-Token` header against a secret registered with setWebhook (`allowed_updates`: message, channel_post, callback_query). Deploy with JWT verification off, because Telegram can't send one. Return 200 immediately and do the work in `EdgeRuntime.waitUntil`. Record each update_id in a `telegram_updates` table, so a redelivered update is ignored. Only process chats in an ALLOWED_CHAT_IDS list. While the list is empty, reply with the chat id to help setup, then stay silent to strangers.
2. Acknowledge instantly: reply under the note ("Working on this note…" / "Got your voice note. Transcribing it…"). Later, edit that same message into the review sheet, rejection or error, so there is always a visible reply.
3. Voice and audio: download the file via getFile (20 MB limit; refuse recordings over 20 minutes) and transcribe verbatim with the dedicated transcription model (e.g. gemini-3.5-transcribe). It returns `audioTranscription` parts, not text. Pass `audioTranscriptionConfig: { languageCodes: ['en-IN','hi-IN','ml-IN'], customVocabulary: [her technical terms] }`. Fall back to a Flash model with a "transcribe verbatim, don't translate or clean up" prompt. Every reply for a voice note shows a `Heard: "…"` line.
4. Screen: Gemini structured JSON (responseJsonSchema) scoring 1–10 against a strict rubric, returning publishable, category (one of her categories), core_idea, reasons, missing[] and search_query. Reject anything below 6, anything sales-led, anything medical, or anything that would need invented facts, and reply with what's missing. Don't force every note into a draft.
5. News angle: one Gemini call with the googleSearch tool. It must reply in a fixed FOUND/FACT/SOURCE/DATE/RELEVANCE format. Use the angle only if the grounding metadata actually has results. Take source links from groundingChunks/groundingSupports, never from model-written text. Make a single attempt with no fallback cycling (on the free tier search shares one quota and retries burn the per-minute allowance), and continue without an angle if it fails.
6. Draft: voice-skill.txt (bundled into the function as a generated JS module, with a test that fails if it's stale) is the system prompt. Hard rules:
   - Use only facts from the note, the sourced angle, or her profile.
   - Don't add figures, dates, quotes, quantities, timeframes, causes, outcomes or judgements she didn't state, and don't strengthen her claims ("a couple" stays a couple; "work I've read" doesn't become "the clinical literature").
   - Never write hypothetical figures.
   - Put gaps in [CHECK: …] placeholders.
   - Attribute the angle by source name, and never attribute quotes.
   - Use contractions and Indian/British spelling, as she does.
   - 150–300 words, no emoji, hashtags, exclamation points, CTAs or sign-off.
   Output JSON: post, angle_used, opening_type, facts_to_verify[].
7. Deterministic checks in code: a voice lint (emoji, hashtags, '!', her banned words, CTA phrases, opening with a question) that triggers one revision pass, and a check that flags any number in the draft not found in the note, angle or profile. Show both, plus facts_to_verify, under "Check before posting".
8. Output: a review sheet headed "DRAFT: WAITING FOR YOUR REVIEW. Nothing has been posted or scheduled." (score, category, idea, angle + sources or why none, things to check), then the post as its own plain-text message so it copies cleanly, threaded under her note, with inline buttons:
   - Approve: status=approved; edit the review header to APPROVED; remove the buttons. It still never posts.
   - Redraft: reuse the saved note, screen and angle (retry the search only if it had failed). Tell the model to change the opening and structure versus earlier versions, keep version history, mark the old review as replaced, and send the new version with fresh buttons.
   - Delete: switch to a Yes/Cancel confirmation first, then delete the row and the bot's own messages (never her note).
   Commands: /drafts (recent drafts with status), /draft <id> (resend with buttons), /help.

STORAGE (Supabase)
Tables: drafts(id, chat_id, status, created_at, score, core_idea, record jsonb), telegram_updates(update_id pk), bot_events(at, update_id, event, detail). Enable RLS on all of them with no policies, so only the secret key can read or write. Use the REST API with fetch:
- New `sb_secret_…` keys go in the `apikey` header only.
- `Prefer: return=minimal` returns an empty body, so don't parse it as JSON.
- Dedupe with `on_conflict` + `resolution=ignore-duplicates`.
- Edge-function secrets can't start with SUPABASE_, so name the key e.g. SB_SECRET_KEY. SUPABASE_URL is injected.

RELIABILITY (these all caused real failures before)
- The edge function is killed at 150s wall clock with no chance to reply. Run each request under a ~115s budget (AsyncLocalStorage deadline). Give the optional news search its own ~35s slice, cap each call (httpOptions.timeout ~45s, transcription ~30s), and skip waits that don't fit.
- On 503, 429, 504 or a timeout/abort, move to the next model (e.g. 3.7-flash → 3.8-flash → 3.6-flash → 3.5-flash). Treat 404 as next model too (models get retired: list available models first). Only wait out a 429 whose "retry in Ns" is short, then do one short second pass. Show a plain-language error if everything is busy.
- Don't set temperature on Gemini 3+ models. Use thinkingLevel LOW for screening and search, and the default for drafting.
- Free-tier Gemini is roughly 20 requests/day/model and search grounding wasn't available on it. Enable billing.
- Log to bot_events: "received" when an update arrives, then "done" or "crashed" with the outcome, the voice note's length and type, and a per-call trace (model, duration, error). Supabase's logs API was unreliable, so a "received" row with no outcome means the worker was cut off.

DEPLOY AND TESTS
- scripts/deploy.js: sync secrets and upload the function through the Supabase Management API (POST /v1/projects/{ref}/functions/deploy?slug=telegram, multipart: metadata with entrypoint_path, import_map_path and verify_jwt:false, plus every lib/*.js file at its repo path). No CLI or Docker. Also scripts/set-webhook.js, a local `try` script that runs the pipeline on a note without Telegram, and SQL migrations.
- node:test, offline, with fetch faked:
  - voice lint, the number check and the angle parser
  - Approve, Delete confirm, Cancel and non-allow-listed taps
  - voice note → download → transcript → screening → "Heard:" reply
  - the time budget failing fast
  - a no-publish test that fails if the code gains a LinkedIn or posting-tool call, a scheduler (cron, pg_cron, GitHub Actions), or any runtime host besides api.telegram.org
  - the voice-profile bundle being out of date

CHECKPOINTS, in order: webhook live and rejecting bad secrets → a text note returns a draft → it sounds like her, not generic (compare against voice-skill.txt, and list any embellishments) → voice note transcribed and drafted → Approve, Redraft and Delete each work in the channel.
