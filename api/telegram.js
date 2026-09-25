// Vercel serverless function: Telegram webhook endpoint (POST /api/telegram).
import { waitUntil } from '@vercel/functions';
import { handleUpdate } from '../lib/bot.js';

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'meera-draft-bot' });
  if (req.method !== 'POST') return res.status(405).end();

  // Telegram echoes the secret we registered with setWebhook; anything else isn't Telegram.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).end();
  }

  // Acknowledge immediately so Telegram doesn't redeliver while Gemini is working,
  // and keep the function alive until the reply has been sent.
  waitUntil(handleUpdate(req.body).catch((err) => console.error('handleUpdate:', err)));
  return res.status(200).json({ ok: true });
}
