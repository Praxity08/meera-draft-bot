// Supabase Edge Function: Telegram webhook endpoint. Telegram calls this the moment a note is posted.
// Deployed with verify_jwt off (Telegram can't send a Supabase JWT); the webhook secret is checked instead.
import { handleUpdate } from '../../../lib/bot.js';
import { logEvent } from '../../../lib/store.js';

Deno.serve(async (req) => {
  if (req.method === 'GET') return Response.json({ ok: true, service: 'meera-draft-bot' });
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response(null, { status: 401 });
  }

  const update = await req.json();
  const kind = update.channel_post ? 'channel_post' : update.message ? 'message' : Object.keys(update).find((k) => k !== 'update_id');
  await logEvent(update.update_id, 'received', kind);
  // Acknowledge straight away so Telegram doesn't redeliver while Gemini works; the runtime keeps
  // the worker alive until the background task finishes (150s wall clock on the free plan).
  const started = Date.now();
  EdgeRuntime.waitUntil(
    handleUpdate(update)
      .then((outcome) => logEvent(update.update_id, 'done', `${outcome ?? 'handled'} in ${((Date.now() - started) / 1000).toFixed(1)}s`))
      .catch((err) => logEvent(update.update_id, 'crashed', err?.stack ?? String(err))),
  );
  return Response.json({ ok: true });
});
