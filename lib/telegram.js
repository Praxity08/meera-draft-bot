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

// Returns the ids of the sent message(s); long text is split across several.
export async function sendMessage(chatId, text, extra = {}) {
  const ids = [];
  for (let i = 0; i < text.length; i += LIMIT) {
    const last = i + LIMIT >= text.length;
    const sent = await call('sendMessage', {
      chat_id: chatId,
      text: text.slice(i, i + LIMIT),
      link_preview_options: { is_disabled: true },
      ...extra,
      ...(last ? {} : { reply_markup: undefined }), // buttons only on the final part
    });
    ids.push(sent.message_id);
  }
  return ids;
}

export const sendTyping = (chatId) => call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

// Downloads a file the chat sent (bots can fetch up to 20 MB). Returns the raw bytes.
export async function downloadFile(fileId) {
  const { file_path } = await call('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${env('TELEGRAM_BOT_TOKEN')}/${file_path}`);
  if (!res.ok) throw new Error(`telegram file download: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export const telegram = call;
