import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintVoice, unsupportedNumbers, parseAngle, sourcesForFact } from '../lib/checks.js';

test('lintVoice passes a clean post', () => {
  const post = 'In 2021 I was sitting in a stability review meeting.\n\nThe actives were intact. It was designed for the wrong context.';
  assert.deepEqual(lintVoice(post), []);
});

test('lintVoice catches hype, emoji, hashtags, CTAs, question openers', () => {
  const issues = lintVoice('Is your serum working? This is a game-changer! ✨ #skincare Let me know in the comments.');
  assert.ok(issues.includes('opens with a question'));
  assert.ok(issues.includes('contains emoji'));
  assert.ok(issues.includes('contains hashtag'));
  assert.ok(issues.includes('contains exclamation point'));
  assert.ok(issues.some((i) => i.includes('game-changer')));
  assert.ok(issues.some((i) => i.includes('let me know')));
});

test('unsupportedNumbers flags figures not in the sources and skips placeholders', () => {
  const post = 'By week six, 40% had oxidised. Our return rate was [CHECK: 2025 return rate 12%]. pH 3.5 is typical.';
  const flagged = unsupportedNumbers(post, ['we tested and 40% went orange']);
  assert.deepEqual(flagged, ['3.5']);
});

test('parseAngle reads the line format, including markdown bold', () => {
  const a = parseAngle('**FOUND:** yes\nFACT: CDSCO issued a notice.\nSOURCE: The Hindu\nDATE: 3 March 2026\nRELEVANCE: ties in.');
  assert.equal(a.found, true);
  assert.equal(a.fact, 'CDSCO issued a notice.');
  assert.equal(a.source, 'The Hindu');
  assert.equal(parseAngle('FOUND: no').found, false);
});

test('sourcesForFact keeps only the chunks that support the fact', () => {
  const chunks = [{ title: 'a.com', uri: 'u1' }, { title: 'b.com', uri: 'u2' }];
  const supports = [{ text: 'CDSCO issued a notice.', chunkIndices: [1] }, { text: 'unrelated', chunkIndices: [0] }];
  const r = sourcesForFact('CDSCO issued a notice.', chunks, supports);
  assert.equal(r.matched, true);
  assert.deepEqual(r.sources, [{ title: 'b.com', uri: 'u2' }]);
});

test('Gemini calls give up with a 504 once the time budget is spent', async () => {
  process.env.GEMINI_API_KEY ??= 'unused';
  const { withBudget, generateJSON } = await import('../lib/gemini.js');
  const t0 = Date.now();
  await assert.rejects(
    withBudget(1_000, () => generateJSON({ model: 'gemini-3.8-flash', system: 's', prompt: 'p', schema: { type: 'object' } })),
    (err) => err.status === 504,
  );
  assert.ok(Date.now() - t0 < 500, 'should fail fast without calling Gemini');
});

test('a call cancelled by our timeout counts as temporary, so the next model is tried', async () => {
  const { isTransient } = await import('../lib/gemini.js');
  assert.ok(isTransient(Object.assign(new Error('The signal has been aborted'), { name: 'AbortError' })));
  assert.ok(isTransient(new Error('The signal has been aborted')));
  assert.ok(!isTransient(new Error('Invalid JSON schema')));
});
