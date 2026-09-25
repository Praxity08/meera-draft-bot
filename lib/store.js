// Draft storage. Supabase Postgres (via its REST API) when SUPABASE_URL and a secret key are set,
// which is always the case inside the edge function; otherwise JSON files in .local-drafts/.
import { env } from './env.js';

const SB_URL = env('SUPABASE_URL');
// Custom edge-function secrets can't start with SUPABASE_, hence SB_SECRET_KEY there.
const SB_KEY = env('SB_SECRET_KEY') || env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
export const backend = SB_URL && SB_KEY ? 'supabase' : 'local';

async function rest(path, { method = 'GET', body, prefer } = {}) {
  // New-style sb_secret_ keys go in `apikey` only; legacy service-role JWTs also need Authorization.
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (!SB_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${SB_KEY}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`supabase ${method} ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  const text = await res.text(); // empty with Prefer: return=minimal
  return text ? JSON.parse(text) : null;
}

const newId = () => [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function saveDraft(chatId, result) {
  const id = newId();
  const record = { id, chatId, status: 'awaiting_review', createdAt: new Date().toISOString(), ...result };
  if (backend === 'supabase') {
    await rest('drafts', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { id, chat_id: String(chatId), score: result.screen.score, core_idea: result.screen.core_idea, record },
    });
  } else {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync('.local-drafts', { recursive: true });
    writeFileSync(`.local-drafts/${record.createdAt.slice(0, 10)}-${id}.json`, JSON.stringify(record, null, 2) + '\n');
  }
  return id;
}

async function localRecords() {
  const { readdirSync, readFileSync, existsSync } = await import('node:fs');
  if (!existsSync('.local-drafts')) return [];
  return readdirSync('.local-drafts').filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`.local-drafts/${f}`, 'utf8')));
}

export async function getDraft(chatId, id) {
  if (backend === 'supabase') {
    const rows = await rest(`drafts?select=record&id=eq.${encodeURIComponent(id)}&chat_id=eq.${encodeURIComponent(chatId)}`);
    return rows[0]?.record ?? null;
  }
  return (await localRecords()).find((r) => r.id === id && String(r.chatId) === String(chatId)) ?? null;
}

export async function listDrafts(chatId, n = 5) {
  if (backend === 'supabase') {
    const rows = await rest(`drafts?select=record&chat_id=eq.${encodeURIComponent(chatId)}&order=created_at.desc&limit=${n}`);
    return rows.map((r) => r.record);
  }
  return (await localRecords())
    .filter((r) => String(r.chatId) === String(chatId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, n);
}

// Telegram redelivers a webhook it thinks failed. Returns false if this update was already claimed.
export async function claimUpdate(updateId) {
  if (backend !== 'supabase') return true;
  const rows = await rest('telegram_updates?on_conflict=update_id', {
    method: 'POST',
    prefer: 'resolution=ignore-duplicates,return=representation',
    body: { update_id: updateId },
  });
  return rows.length > 0;
}

// Best-effort outcome log (bot_events). Never throws: logging must not break a reply.
export async function logEvent(updateId, event, detail = null) {
  if (backend !== 'supabase') return;
  try {
    await rest('bot_events', { method: 'POST', prefer: 'return=minimal', body: { update_id: updateId, event, detail: detail && String(detail).slice(0, 4000) } });
  } catch (err) {
    console.error('logEvent failed:', err);
  }
}
