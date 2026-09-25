// Handles one Telegram update. Replies only to allow-listed chats (Meera's).
import { runPipeline } from './pipeline.js';
import { formatRejection, formatReview, formatDraftList } from './format.js';
import { saveDraft, getDraft, listDrafts, claimUpdate, backend } from './store.js';
import { sendMessage, sendTyping } from './telegram.js';

const allowedChats = () =>
  (process.env.ALLOWED_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

const HELP = `Send me a note fragment (the transcript text of a voice note).

I will:
1. Screen it. If it's too thin to write from, I say why and what's missing.
2. If it passes, look for a current news item or data point to anchor it.
3. Send back a LinkedIn DRAFT in your voice, plus a list of things to check.

I never post, schedule, or send anything anywhere. Every draft waits for you.

/drafts lists recent drafts. /draft <id> shows one again.`;

export async function handleUpdate(update) {
  // Notes can come from a private chat/group (message) or Meera's notes channel (channel_post).
  const msg = update.message ?? update.channel_post;
  if (!msg?.chat) return;
  const chatId = msg.chat.id;

  if (!(await claimUpdate(update.update_id))) return;

  const allowed = allowedChats();
  if (!allowed.includes(String(chatId))) {
    if (!allowed.length) {
      await sendMessage(chatId, `Setup: this chat's id is ${chatId}. Add it to ALLOWED_CHAT_IDS and redeploy. Until then I won't process notes.`);
    }
    return; // stay silent to strangers once the allow-list is set
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
      return sendMessage(chatId, backend === 'none' ? 'Draft storage is not configured on this deployment.' : formatDraftList(await listDrafts(chatId)));
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
  await sendMessage(chatId, 'Got it. Screening this note.', reply);
  await sendTyping(chatId);

  try {
    const result = await runPipeline(text, { onStage: () => sendTyping(chatId) });
    if (result.status === 'rejected') return sendMessage(chatId, formatRejection(result), reply);

    let id = null;
    try {
      id = await saveDraft(chatId, result);
    } catch (err) {
      console.error('saveDraft failed:', err);
    }
    await sendMessage(chatId, formatReview(result, id), reply);
    await sendMessage(chatId, result.draft.post, reply);
  } catch (err) {
    console.error('pipeline failed:', err);
    await sendMessage(chatId, `Something failed while processing that note (${err?.message ?? 'unknown error'}). Nothing was saved. Try sending it again.`, reply);
  }
}
