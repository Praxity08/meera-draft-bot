// Human review is a hard gate: fail the build if any code gains a path to publish or schedule posts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const FORBIDDEN = [
  /linkedin\.com|ugcPosts|\/rest\/posts/i,              // LinkedIn API
  /schedulePost|scheduledAt|publishPost/i,              // post scheduling/publishing helpers
  /buffer\.com|hootsuite|zapier|make\.com|ifttt/i,      // third-party posting tools
  /pg_cron|cron\.schedule/i,                            // database-side schedulers
];

function files(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name), ext) : ext.some((x) => e.name.endsWith(x)) ? [path.join(dir, e.name)] : [],
  );
}

const code = ['lib', 'scripts', 'supabase'].flatMap((d) => files(d, ['.js', '.sql']));

test('no publishing or scheduling code anywhere', () => {
  for (const file of code) {
    if (file === 'lib/voice-profile.js') continue; // Meera's profile text, not code
    const src = readFileSync(file, 'utf8');
    for (const re of FORBIDDEN) assert.ok(!re.test(src), `${file} matches ${re}`);
  }
});

test('outbound hosts are limited to Telegram (runtime) and the Supabase Management API (deploy)', () => {
  for (const file of code.filter((f) => f.endsWith('.js') && f !== 'lib/voice-profile.js')) {
    for (const [url] of readFileSync(file, 'utf8').matchAll(/https?:\/\/[^\s'"`/]+/g)) {
      const ok = url === 'https://api.telegram.org' || (file.startsWith('scripts/') && ['https://api.supabase.com', 'https://${REF}.supabase.co'].includes(url));
      assert.ok(ok, `${file} calls ${url}`);
    }
  }
});

test('no GitHub Actions or other schedulers are defined', () => {
  assert.equal(existsSync('.github/workflows'), false);
});
