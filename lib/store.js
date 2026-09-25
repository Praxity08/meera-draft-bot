// Draft storage. Upstash Redis (REST) when configured, a local drafts/ folder during
// local runs, and nothing otherwise (the Telegram message is then the only copy).
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const LOCAL_DIR = path.join(process.cwd(), 'drafts');

export const backend = REDIS_URL && REDIS_TOKEN ? 'redis' : process.env.VERCEL ? 'none' : 'local';

async function redis(...command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const json = await res.json();
  if (json.error) throw new Error(`redis: ${json.error}`);
  return json.result;
}

export async function saveDraft(chatId, result) {
  if (backend === 'none') return null;
  const id = randomBytes(3).toString('hex');
  const record = { id, chatId, status: 'awaiting_review', createdAt: new Date().toISOString(), ...result };

  if (backend === 'redis') {
    await redis('SET', `draft:${id}`, JSON.stringify(record));
    await redis('LPUSH', `drafts:${chatId}`, id);
    await redis('LTRIM', `drafts:${chatId}`, 0, 199);
  } else {
    mkdirSync(LOCAL_DIR, { recursive: true });
    writeFileSync(path.join(LOCAL_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  }
  return id;
}

export async function getDraft(chatId, id) {
  let record = null;
  if (backend === 'redis') {
    const raw = await redis('GET', `draft:${id}`);
    record = raw ? JSON.parse(raw) : null;
  } else if (backend === 'local') {
    const file = path.join(LOCAL_DIR, `${id.replace(/[^a-f0-9]/g, '')}.json`);
    record = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  }
  return record && String(record.chatId) === String(chatId) ? record : null;
}

export async function listDrafts(chatId, n = 5) {
  if (backend === 'redis') {
    const ids = await redis('LRANGE', `drafts:${chatId}`, 0, n - 1);
    const records = await Promise.all(ids.map((id) => getDraft(chatId, id)));
    return records.filter(Boolean);
  }
  if (backend === 'local' && existsSync(LOCAL_DIR)) {
    return readdirSync(LOCAL_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(path.join(LOCAL_DIR, f), 'utf8')))
      .filter((r) => String(r.chatId) === String(chatId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, n);
  }
  return [];
}

// Telegram redelivers an update if it doesn't get a timely 200. Returns false for repeats.
export async function claimUpdate(updateId) {
  if (backend !== 'redis') return true;
  return (await redis('SET', `update:${updateId}`, '1', 'NX', 'EX', 86400)) === 'OK';
}
