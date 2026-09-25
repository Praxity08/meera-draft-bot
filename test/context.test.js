import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildContextModule } from '../scripts/build-context.js';

test('lib/voice-profile.js matches context/ (run npm run build:context after editing it)', () => {
  assert.equal(readFileSync('lib/voice-profile.js', 'utf8'), buildContextModule());
});
