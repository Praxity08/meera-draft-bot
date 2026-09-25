// Draft storage as JSON files. In GitHub Actions, DRAFTS_DIR=drafts and the workflow commits
// the new files, so the private repo is the review history. Local runs default to .local-drafts/.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const DIR = path.join(process.cwd(), process.env.DRAFTS_DIR || '.local-drafts');

export async function saveDraft(chatId, result) {
  const id = randomBytes(3).toString('hex');
  const record = { id, chatId, status: 'awaiting_review', createdAt: new Date().toISOString(), ...result };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, `${record.createdAt.slice(0, 10)}-${id}.json`), JSON.stringify(record, null, 2) + '\n');
  return id;
}

function all() {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(DIR, f), 'utf8')));
}

export async function getDraft(chatId, id) {
  return all().find((r) => r.id === id && String(r.chatId) === String(chatId)) ?? null;
}

export async function listDrafts(chatId, n = 5) {
  return all()
    .filter((r) => String(r.chatId) === String(chatId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, n);
}
