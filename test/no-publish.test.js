// Human review is a hard gate: fail the build if any code gains a path to publish or schedule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FORBIDDEN = [/linkedin\.com\/v2|api\.linkedin\.com|ugcPosts|\/rest\/posts/i, /\bcron\b|setInterval|schedulePost|scheduledAt/i, /buffer\.com|hootsuite|zapier|make\.com/i];

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : [],
  );
}

test('no publishing or scheduling code in api/, lib/, scripts/', () => {
  for (const file of ['api', 'lib', 'scripts'].flatMap(sourceFiles)) {
    const src = readFileSync(file, 'utf8');
    for (const re of FORBIDDEN) assert.ok(!re.test(src), `${file} matches ${re}`);
  }
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.equal(vercel.crons, undefined, 'vercel.json must not define crons');
});
