// Supabase Edge Function: Telegram webhook endpoint. Telegram calls this the moment a note is posted.
// Deployed with verify_jwt off (Telegram can't send a Supabase JWT); the webhook secret is checked instead.
import { handleUpdate } from '../../../lib/bot.js';

Deno.serve(async (req) => {
  if (req.method === 'GET') return Response.json({ ok: true, service: 'meera-draft-bot' });
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response(null, { status: 401 });
  }

  const update = await req.json();
  // Acknowledge straight away so Telegram doesn't redeliver while Gemini works; the runtime keeps
  // the worker alive until the background task finishes (150s wall clock on the free plan).
  EdgeRuntime.waitUntil(
    handleUpdate(update)
      .then((outcome) => console.log(`update ${update.update_id}: ${outcome ?? 'handled'}`))
      .catch((err) => console.error(`update ${update.update_id} failed:`, err)),
  );
  return Response.json({ ok: true });
});
