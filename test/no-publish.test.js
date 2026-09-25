// Human review is a hard gate: fail the build if any code gains a path to publish or schedule posts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FORBIDDEN = [
  /linkedin\.com|ugcPosts|\/rest\/posts/i,              // LinkedIn API
  /schedulePost|scheduledAt|publishPost/i,              // post scheduling/publishing helpers
  /buffer\.com|hootsuite|zapier|make\.com|ifttt/i,      // third-party posting tools
];

function files(dir, ext) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name), ext) : ext.some((x) => e.name.endsWith(x)) ? [path.join(dir, e.name)] : [],
  );
}

const code = [...['lib', 'scripts'].flatMap((d) => files(d, ['.js'])), ...files('.github', ['.yml', '.yaml'])];

test('no publishing or scheduling code anywhere', () => {
  for (const file of code) {
    const src = readFileSync(file, 'utf8');
    for (const re of FORBIDDEN) assert.ok(!re.test(src), `${file} matches ${re}`);
  }
});

test('the only outbound host is Telegram (Gemini goes through its SDK)', () => {
  for (const file of code.filter((f) => f.endsWith('.js'))) {
    for (const [url] of readFileSync(file, 'utf8').matchAll(/https?:\/\/[^\s'"`/]+/g)) {
      assert.equal(url, 'https://api.telegram.org', `${file} calls ${url}`);
    }
  }
});

test('the workflow only runs the polling script', () => {
  const wf = readFileSync('.github/workflows/poll.yml', 'utf8');
  const runs = [...wf.matchAll(/^\s*-?\s*run:\s*(.+)$/gm)].map((m) => m[1].trim());
  assert.ok(runs.includes('node scripts/poll.js'));
  for (const r of runs) assert.ok(['npm ci --omit=dev', 'node scripts/poll.js', '|'].includes(r), `unexpected run step: ${r}`);
});
