// Minimal Telegram Bot API client. It only replies in chat; it has no way to post anywhere else.
import { env } from './env.js';

const LIMIT = 4000; // Telegram caps messages at 4096 chars

async function call(method, body) {
  const token = env('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description}`);
  return json.result;
}

export async function sendMessage(chatId, text, extra = {}) {
  for (let i = 0; i < text.length; i += LIMIT) {
    await call('sendMessage', {
      chat_id: chatId,
      text: text.slice(i, i + LIMIT),
      link_preview_options: { is_disabled: true },
      ...extra,
    });
  }
}

export const sendTyping = (chatId) => call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

export const telegram = call;
