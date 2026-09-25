// Approve / Delete button flows against a fake Telegram and the local file store (no network, no Gemini).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHAT = -1001;
const calls = [];
let nextMessageId = 100;
let bot, store;

before(async () => {
  process.chdir(mkdtempSync(path.join(tmpdir(), 'bot-test-')));
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.ALLOWED_CHAT_IDS = String(CHAT);
  delete process.env.SUPABASE_URL;
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop();
    calls.push({ method, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: nextMessageId++ } }));
  };
  bot = await import('../lib/bot.js');
  store = await import('../lib/store.js');
});

// Methods the button handlers may use. Anything else (e.g. forwarding, posting elsewhere) fails the test.
const REPLY_ONLY = new Set(['answerCallbackQuery', 'editMessageText', 'editMessageReplyMarkup', 'deleteMessage', 'sendMessage', 'sendChatAction']);

async function makeDraft() {
  const record = await store.saveDraft(CHAT, {
    note: 'n', status: 'awaiting_review',
    screen: { score: 8, category: 'Consumer Education', core_idea: 'idea', reasons: '', missing: [] },
    angle: { usable: false }, draft: { post: 'The post.', opening_type: 'plain claim', facts_to_verify: [] },
    voiceIssues: [], unverifiedNumbers: [], messages: { note: 1, review: [10], draft: [11] },
  });
  await store.updateDraft(CHAT, record);
  return record;
}

const tap = (data, messageId = 11, chat = CHAT) =>
  bot.handleUpdate({ update_id: Math.random(), callback_query: { id: 'q', data, message: { chat: { id: chat }, message_id: messageId } } });

test('Approve marks the draft approved, relabels the review, removes buttons, publishes nothing', async () => {
  const { id } = await makeDraft();
  calls.length = 0;
  assert.equal(await tap(`a:${id}`), `approved ${id}`);
  assert.equal((await store.getDraft(CHAT, id)).status, 'approved');
  const edit = calls.find((c) => c.method === 'editMessageText');
  assert.equal(edit.body.message_id, 10);
  assert.match(edit.body.text, /^APPROVED/);
  assert.deepEqual(calls.find((c) => c.method === 'editMessageReplyMarkup').body.reply_markup, { inline_keyboard: [] });
  for (const c of calls) assert.ok(REPLY_ONLY.has(c.method), `unexpected Telegram call ${c.method}`);
});

test('Delete asks for confirmation, then removes the draft and the bot messages', async () => {
  const { id } = await makeDraft();
  calls.length = 0;
  await tap(`d:${id}`);
  assert.ok(await store.getDraft(CHAT, id), 'first tap must not delete');
  assert.equal(calls.find((c) => c.method === 'editMessageReplyMarkup').body.reply_markup.inline_keyboard[0][0].callback_data, `dc:${id}`);

  calls.length = 0;
  assert.equal(await tap(`dc:${id}`), `deleted ${id}`);
  assert.equal(await store.getDraft(CHAT, id), null);
  assert.deepEqual(calls.filter((c) => c.method === 'deleteMessage').map((c) => c.body.message_id).sort(), [10, 11]);
  for (const c of calls) assert.ok(REPLY_ONLY.has(c.method), `unexpected Telegram call ${c.method}`);
});

test('Cancel restores the Approve/Redraft/Delete buttons', async () => {
  const { id } = await makeDraft();
  calls.length = 0;
  await tap(`dx:${id}`);
  const labels = calls.find((c) => c.method === 'editMessageReplyMarkup').body.reply_markup.inline_keyboard[0].map((b) => b.text);
  assert.deepEqual(labels, ['Approve', 'Redraft', 'Delete']);
});

test('buttons from a chat that is not allow-listed do nothing', async () => {
  const { id } = await makeDraft();
  assert.equal(await tap(`dc:${id}`, 11, 999), 'not allow-listed');
  assert.ok(await store.getDraft(CHAT, id));
});
