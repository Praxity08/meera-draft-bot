// Handles one Telegram update. Replies only to allow-listed chats (Meera's).
// Buttons under each draft let her Approve (mark final), Redraft, or Delete. None of them publish.
import { env } from './env.js';
import { runPipeline, draftFromScreen, findAngle } from './pipeline.js';
import { formatRejection, formatReview, formatDraftList } from './format.js';
import { saveDraft, getDraft, listDrafts, updateDraft, deleteDraft, claimUpdate } from './store.js';
import { sendMessage, sendTyping, telegram } from './telegram.js';
import { isTransient, withBudget } from './gemini.js';
import { audioOf, transcribe, MAX_AUDIO_SECONDS } from './transcribe.js';

// The edge function is killed at 150s without a chance to reply, so Gemini work must finish well before.
const BUDGET_MS = 115_000;

const allowedChats = () =>
  (env('ALLOWED_CHAT_IDS') || '').split(',').map((s) => s.trim()).filter(Boolean);

const HELP = `Send me a note: a voice note, an audio file, or typed text.

For each note I will:
1. Transcribe it if it's audio, then screen it. If it's too thin to write from, I say why and what's missing.
2. If it passes, look for a current news item or data point to anchor it.
3. Send back a LinkedIn DRAFT in your voice, plus a list of things to check.

Under each draft:
Approve saves it as your final version.
Redraft writes a different version from the same note.
Delete removes the draft and my messages about it.

I never post, schedule, or send anything anywhere. Every draft waits for you.

/drafts lists recent drafts. /draft <id> shows one again.`;

const reviewButtons = (id) => ({
  inline_keyboard: [[
    { text: 'Approve', callback_data: `a:${id}` },
    { text: 'Redraft', callback_data: `r:${id}` },
    { text: 'Delete', callback_data: `d:${id}` },
  ]],
});
const confirmDeleteButtons = (id) => ({
  inline_keyboard: [[
    { text: 'Yes, delete it', callback_data: `dc:${id}` },
    { text: 'Cancel', callback_data: `dx:${id}` },
  ]],
});
const noButtons = { inline_keyboard: [] };

const replyTo = (messageId) =>
  messageId ? { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } } : {};

// Telegram rejects edits that change nothing, or messages that are gone; neither should stop the flow.
const quietly = (p) => p.catch((err) => console.error(String(err?.message ?? err)));
const setButtons = (chatId, messageId, markup) =>
  messageId && quietly(telegram('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: markup }));
const setText = (chatId, messageId, text) =>
  messageId && quietly(telegram('editMessageText', { chat_id: chatId, message_id: messageId, text, link_preview_options: { is_disabled: true } }));

// Sends the review sheet and the draft (with buttons) and remembers their message ids on the record.
// With reviewMessageId, the "Working on this note" message is edited into the review sheet instead.
async function sendDraft(chatId, record, { reviewMessageId } = {}) {
  const extra = replyTo(record.messages?.note);
  let review;
  if (reviewMessageId) {
    await setText(chatId, reviewMessageId, formatReview(record, record.id));
    review = [reviewMessageId];
  } else {
    review = await sendMessage(chatId, formatReview(record, record.id), extra);
  }
  const draft = await sendMessage(chatId, record.draft.post, { ...extra, reply_markup: reviewButtons(record.id) });
  record.messages = { ...record.messages, review, draft };
  await updateDraft(chatId, record);
}

export async function handleUpdate(update) {
  if (update.callback_query) {
    const cq = update.callback_query;
    if (!(await claimUpdate(update.update_id))) return 'duplicate delivery';
    if (!allowedChats().includes(String(cq.message?.chat?.id))) {
      await quietly(telegram('answerCallbackQuery', { callback_query_id: cq.id }));
      return 'not allow-listed';
    }
    return handleButton(cq);
  }

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

  const text = (msg.text || '').trim();
  const caption = (msg.caption || '').trim();
  const audio = audioOf(msg);
  if (!text && !audio) return 'ignored';

  const [cmd, ...args] = text.split(/\s+/);
  switch (cmd.replace(/@\w+$/, '').toLowerCase()) {
    case '/start':
    case '/help':
      await sendMessage(chatId, HELP);
      return 'help';
    case '/drafts':
      await sendMessage(chatId, formatDraftList(await listDrafts(chatId)));
      return 'listed drafts';
    case '/draft': {
      const record = args[0] && (await getDraft(chatId, args[0]));
      if (!record) {
        await sendMessage(chatId, 'No draft with that id.');
        return 'draft not found';
      }
      await sendDraft(chatId, record);
      return `resent ${record.id}`;
    }
  }
  if (text.startsWith('/')) {
    await sendMessage(chatId, 'Unknown command. /help lists what I do.');
    return 'unknown command';
  }

  // Thread every reply under the note it belongs to, so drafts stay matched to notes in the channel.
  const reply = replyTo(msg.message_id);

  if (audio?.duration > MAX_AUDIO_SECONDS) {
    await sendMessage(chatId, `That recording is ${Math.round(audio.duration / 60)} minutes. I can take voice notes up to ${MAX_AUDIO_SECONDS / 60} minutes; split it and send the parts.`, reply);
    return 'audio too long';
  }

  // Immediate sign of life; edited into the review sheet, rejection or error once the work is done.
  const [ack] = await sendMessage(chatId, audio
    ? 'Got your voice note. Transcribing it, then working on a draft. Usually about a minute. If nothing appears within 3 minutes, send it again.'
    : 'Working on this note. A draft usually takes about a minute. If nothing appears within 3 minutes, send the note again.', reply);
  await sendTyping(chatId);

  let result;
  try {
    result = await withBudget(BUDGET_MS, async () => {
      let note = text;
      if (audio) {
        const transcript = await transcribe(audio);
        if (!transcript) return { status: 'no_speech' };
        // A caption typed on the voice note is kept as extra context.
        note = caption ? `${transcript}\n\n(Caption: ${caption})` : transcript;
      }
      const out = await runPipeline(note, { onStage: () => sendTyping(chatId) });
      return audio ? { ...out, source: 'voice', audioSeconds: audio.duration } : out;
    });
  } catch (err) {
    console.error('pipeline failed:', err);
    const why = isTransient(err)
      ? 'Gemini is overloaded or rate-limited right now. Send the note again in a few minutes.'
      : `Something went wrong (${err?.message ?? 'unknown error'}). Send the note again to retry.`;
    await setText(chatId, ack, `I couldn't draft this note. ${why} Nothing was saved.`);
    return `failed: ${String(err?.message ?? err).slice(0, 300)}`;
  }

  if (result.status === 'no_speech') {
    await setText(chatId, ack, "I couldn't hear any speech in that recording. Nothing was saved. Try recording it again.");
    return 'no speech';
  }

  if (result.status === 'rejected') {
    await setText(chatId, ack, formatRejection(result));
    return `rejected (${result.screen.score}/10)`;
  }

  const record = await saveDraft(chatId, { ...result, status: 'awaiting_review', messages: { note: msg.message_id } });
  await sendDraft(chatId, record, { reviewMessageId: ack });
  return `drafted ${record.id}${audio ? ' from voice' : ''} (${result.screen.score}/10, angle ${result.angle.usable ? 'used' : result.angle.error ? 'failed' : 'none'})`;
}

async function handleButton(cq) {
  const chatId = cq.message.chat.id;
  const tapped = cq.message.message_id;
  const [action, id] = String(cq.data ?? '').split(':');
  const answer = (text) => quietly(telegram('answerCallbackQuery', { callback_query_id: cq.id, text }));

  const record = id && (await getDraft(chatId, id));
  if (!record) {
    await answer('That draft no longer exists.');
    await setButtons(chatId, tapped, noButtons);
    return `button ${action}: draft ${id} not found`;
  }
  const reviewMsg = record.messages?.review?.[0];

  switch (action) {
    case 'a': {
      record.status = 'approved';
      record.approvedAt = new Date().toISOString();
      await updateDraft(chatId, record);
      await answer('Approved and saved. Nothing was posted.');
      await setText(chatId, reviewMsg, formatReview(record, record.id));
      await setButtons(chatId, tapped, noButtons);
      return `approved ${id}`;
    }

    case 'd':
      await answer('Tap again to confirm.');
      await setButtons(chatId, tapped, confirmDeleteButtons(id));
      return `delete requested ${id}`;

    case 'dx':
      await answer('Kept.');
      await setButtons(chatId, tapped, record.status === 'approved' ? noButtons : reviewButtons(id));
      return `delete cancelled ${id}`;

    case 'dc': {
      await deleteDraft(chatId, id);
      await answer('Deleted.');
      // Remove every message the bot sent about this draft. Meera's own note stays.
      const mine = [...(record.messages?.review ?? []), ...(record.messages?.draft ?? []), tapped];
      for (const mid of new Set(mine)) await quietly(telegram('deleteMessage', { chat_id: chatId, message_id: mid }));
      return `deleted ${id}`;
    }

    case 'r': {
      await answer('Redrafting. This takes about a minute.');
      await setButtons(chatId, tapped, noButtons);
      await sendTyping(chatId);
      try {
        // Reuse the saved angle, but try the search again if it failed the first time.
        const { angle, next } = await withBudget(BUDGET_MS, async () => {
          let angle = record.angle;
          if (!angle?.usable && angle?.error) {
            angle = await findAngle(record.screen).catch((err) => ({ usable: false, error: String(err?.message ?? err) }));
          }
          const previous = [...(record.history ?? []).map((h) => h.post), record.draft.post];
          return { angle, next: await draftFromScreen(record.note, record.screen, angle, { previous }) };
        });

        await setText(chatId, reviewMsg, formatReview({ ...record, status: 'superseded' }, null));

        record.history = [...(record.history ?? []), { version: record.version ?? 1, post: record.draft.post, at: new Date().toISOString() }];
        Object.assign(record, next, { angle, status: 'awaiting_review', version: (record.version ?? 1) + 1 });
        delete record.approvedAt;
        await sendDraft(chatId, record);
        return `redrafted ${id} to version ${record.version}`;
      } catch (err) {
        console.error('redraft failed:', err);
        await setButtons(chatId, tapped, reviewButtons(id));
        await sendMessage(chatId, `I couldn't redraft this one (${isTransient(err) ? 'Gemini is overloaded or rate-limited right now' : err?.message ?? 'unknown error'}). The current draft is unchanged. Tap Redraft again in a few minutes.`, replyTo(tapped));
        return `redraft failed ${id}: ${String(err?.message ?? err).slice(0, 200)}`;
      }
    }
  }

  await answer('Unknown action.');
  return `unknown button ${action}`;
}
