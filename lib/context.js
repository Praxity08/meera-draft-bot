// Meera's writing context: the voice profile plus any published reference pieces.
// Bundled from context/ by scripts/build-context.js.
import { VOICE, PUBLISHED } from './voice-profile.js';

const MAX_REFERENCE_CHARS = 30_000; // keep the prompt bounded if published/ grows

export function loadContext() {
  const published = [];
  let total = 0;
  for (const p of PUBLISHED) {
    if (total + p.text.length > MAX_REFERENCE_CHARS) continue;
    total += p.text.length;
    published.push(p);
  }
  return { voice: VOICE, published };
}

export function referenceBlock(published) {
  if (!published.length) return '';
  return (
    '\n\n# Published reference pieces (for grounding her voice — do not copy sentences)\n' +
    published.map((p) => `\n--- ${p.name} ---\n${p.text}`).join('\n')
  );
}
