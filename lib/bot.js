// Handles one Telegram update. Replies only to allow-listed chats (Meera's).
import { env } from './env.js';
import { runPipeline } from './pipeline.js';
import { formatRejection, formatReview, formatDraftList } from './format.js';
import { saveDraft, getDraft, listDrafts, claimUpdate } from './store.js';
import { sendMessage, sendTyping } from './telegram.js';
import { isTransient } from './gemini.js';


const allowedChats = () =>
  (env('ALLOWED_CHAT_IDS') || '').split(',').map((s) => s.trim()).filter(Boolean);

const HELP = `Send me a note fragment (the transcript text of a voice note).

For each note I will:
1. Screen it. If it's too thin to write from, I say why and what's missing.
2. If it passes, look for a current news item or data point to anchor it.
3. Send back a LinkedIn DRAFT in your voice, plus a list of things to check.

I never post, schedule, or send anything anywhere. Every draft waits for you.

/drafts lists recent drafts. /draft <id> shows one again.`;

export async function handleUpdate(update) {
  // Notes can come from a private chat/group (message) or Meera's notes channel (channel_post).
  const msg = update.message ?? update.channel_post;
  if (!msg?.chat) return 'ignored';
  const chatId = msg.chat.id;

  if (!(await claimUpdate(update.update_id))) return 'duplicate delivery';

  const allowed = allowedChats();
  if (!allowed.includes(String(chatId))) {
    if (!allowed.length) {
      await sendMessage(chatId, `Setup: this chat's id is ${chatId}. Add it to the ALLOWED_CHAT_IDS secret. Until then I won't process notes.`);
    }
    return 'not allow-listed'; // stay silent to strangers once the allow-list is set
  }

  const text = (msg.text || msg.caption || '').trim();

  if (!text) {
    if (msg.voice || msg.audio) {
      await sendMessage(chatId, "I can't transcribe audio yet. Send the transcript as text and I'll screen it.");
    }
    return;
  }

  const [cmd, ...args] = text.split(/\s+/);
  switch (cmd.replace(/@\w+$/, '').toLowerCase()) {
    case '/start':
    case '/help':
      return sendMessage(chatId, HELP);
    case '/drafts':
      return sendMessage(chatId, formatDraftList(await listDrafts(chatId)));
    case '/draft': {
      const record = args[0] && (await getDraft(chatId, args[0]));
      if (!record) return sendMessage(chatId, 'No draft with that id.');
      await sendMessage(chatId, formatReview(record, record.id));
      return sendMessage(chatId, record.draft.post);
    }
  }
  if (cmd.startsWith('/')) return sendMessage(chatId, 'Unknown command. /help lists what I do.');

  // Thread every reply under the note it belongs to, so drafts stay matched to notes in the channel.
  const reply = { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } };
  await sendTyping(chatId);

  let result;
  try {
    result = await runPipeline(text, { onStage: () => sendTyping(chatId) });
  } catch (err) {
    console.error('pipeline failed:', err);
    const why = isTransient(err)
      ? 'Gemini is overloaded or rate-limited right now. Send the note again in a few minutes.'
      : `Something went wrong (${err?.message ?? 'unknown error'}). Send the note again to retry.`;
    await sendMessage(chatId, `I couldn't draft this note. ${why} Nothing was saved.`, reply);
    return `failed: ${String(err?.message ?? err).slice(0, 300)}`;
  }

  if (result.status === 'rejected') {
    await sendMessage(chatId, formatRejection(result), reply);
    return `rejected (${result.screen.score}/10)`;
  }

  let id = null;
  try {
    id = await saveDraft(chatId, result);
  } catch (err) {
    console.error('saveDraft failed:', err);
  }
  await sendMessage(chatId, formatReview(result, id), reply);
  await sendMessage(chatId, result.draft.post, reply);
  return `drafted ${id} (${result.screen.score}/10, angle ${result.angle.usable ? 'used' : result.angle.error ? 'failed' : 'none'})`;
}
