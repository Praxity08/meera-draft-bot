// Deploys the telegram edge function to Supabase and syncs its secrets from .env.
//   npm run deploy            (needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in .env)
// Uses the Management API directly, so no Supabase CLI or Docker is needed.
import { readFileSync, readdirSync } from 'node:fs';
import { buildContextModule } from './build-context.js';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN || !REF) {
  console.error('Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in .env');
  process.exit(1);
}
const API = `https://api.supabase.com/v1/projects/${REF}`;
const auth = { Authorization: `Bearer ${TOKEN}` };

if (readFileSync('lib/voice-profile.js', 'utf8') !== buildContextModule()) {
  console.error('lib/voice-profile.js is stale. Run: node scripts/build-context.js');
  process.exit(1);
}

// 1. Secrets the function reads. SUPABASE_URL is provided by the platform.
const secrets = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ALLOWED_CHAT_IDS: process.env.ALLOWED_CHAT_IDS,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
  SB_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
};
const missing = Object.entries(secrets).filter(([, v]) => !v).map(([k]) => k);
// Optional: enables the Google News angle (Claude picks the item).
if (process.env.ANTHROPIC_API_KEY) secrets.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}
let res = await fetch(`${API}/secrets`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify(Object.entries(secrets).map(([name, value]) => ({ name, value }))),
});
console.log(`secrets: HTTP ${res.status}`);
if (!res.ok) process.exit(1);

// 2. Function code: the entry point plus everything it imports, at their repo paths.
const FILES = [
  'supabase/functions/telegram/index.js',
  'supabase/functions/telegram/deno.json',
  ...readdirSync('lib').filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`),
];
const form = new FormData();
form.append('metadata', JSON.stringify({
  name: 'telegram',
  entrypoint_path: 'supabase/functions/telegram/index.js',
  import_map_path: 'supabase/functions/telegram/deno.json',
  verify_jwt: false,
}));
for (const f of FILES) form.append('file', new Blob([readFileSync(f)]), f);

res = await fetch(`${API}/functions/deploy?slug=telegram`, { method: 'POST', headers: auth, body: form });
const body = await res.text();
console.log(`deploy: HTTP ${res.status} ${body.slice(0, 300)}`);
if (!res.ok) process.exit(1);
console.log(`function URL: https://${REF}.supabase.co/functions/v1/telegram`);
