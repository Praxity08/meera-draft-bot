// Voice note → download → transcript → screening, with Telegram and Gemini faked at the fetch level.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHAT = -1002;
const calls = [];
const TRANSCRIPT = 'something about sunscreen maybe, remind me later';
let bot;

const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

before(async () => {
  process.chdir(mkdtempSync(path.join(tmpdir(), 'voice-test-')));
  Object.assign(process.env, { TELEGRAM_BOT_TOKEN: 'test-token', ALLOWED_CHAT_IDS: String(CHAT), GEMINI_API_KEY: 'test-key' });
  delete process.env.SUPABASE_URL;
  let mid = 500;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('api.telegram.org/file/')) { calls.push({ method: 'download' }); return new Response(new Uint8Array([1, 2, 3])); }
    if (u.includes('api.telegram.org')) {
      const method = u.split('/').pop();
      calls.push({ method, body: JSON.parse(init.body) });
      return json({ ok: true, result: method === 'getFile' ? { file_path: 'voice/file_1.oga' } : { message_id: mid++ } });
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(init.body);
      const model = u.match(/models\/([^:]+):/)[1];
      calls.push({ method: `gemini:${model}`, body });
      if (model.includes('transcribe')) {
        return json({ candidates: [{ content: { role: 'model', parts: [{ audioTranscription: { text: TRANSCRIPT } }] } }] });
      }
      const screen = { score: 2, publishable: false, category: 'None', core_idea: '', reasons: 'Only a topic label.', missing: ['a specific claim'], search_query: '' };
      return json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(screen) }] } }] });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  bot = await import('../lib/bot.js');
});

test('a voice note is downloaded, transcribed, screened, and the reply shows what was heard', async () => {
  const outcome = await bot.handleUpdate({
    update_id: 1,
    channel_post: { message_id: 42, date: 1, chat: { id: CHAT, type: 'channel' }, voice: { file_id: 'F1', mime_type: 'audio/ogg', duration: 12 } },
  });
  assert.equal(outcome, 'rejected (2/10)');

  const transcribeCall = calls.find((c) => c.method.startsWith('gemini:') && c.method.includes('transcribe'));
  assert.equal(transcribeCall.body.contents[0].parts[0].inlineData.mimeType, 'audio/ogg');
  assert.ok(transcribeCall.body.generationConfig?.audioTranscriptionConfig ?? transcribeCall.body.audioTranscriptionConfig, 'sends transcription config');

  const screenCall = calls.find((c) => c.method.startsWith('gemini:') && !c.method.includes('transcribe'));
  assert.match(JSON.stringify(screenCall.body.contents), /something about sunscreen/);

  const ack = calls.find((c) => c.method === 'sendMessage');
  assert.match(ack.body.text, /^Got your voice note/);
  const final = calls.find((c) => c.method === 'editMessageText');
  assert.equal(final.body.message_id, 500);
  assert.match(final.body.text, /NOT DRAFTED/);
  assert.match(final.body.text, new RegExp(`Heard: "${TRANSCRIPT}"`));
});

test('recordings over the limit are refused before downloading', async () => {
  calls.length = 0;
  const outcome = await bot.handleUpdate({
    update_id: 2,
    channel_post: { message_id: 43, date: 1, chat: { id: CHAT, type: 'channel' }, voice: { file_id: 'F2', duration: 60 * 60 } },
  });
  assert.equal(outcome, 'audio too long');
  assert.ok(!calls.some((c) => c.method === 'download' || c.method === 'getFile'));
});
