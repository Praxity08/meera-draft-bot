// Loads Meera's writing context: the voice profile plus any published reference pieces.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const CONTEXT_DIR = path.join(process.cwd(), 'context');
const MAX_REFERENCE_CHARS = 30_000; // keep the prompt bounded if published/ grows

let cached;

export function loadContext() {
  if (cached) return cached;

  const voicePath = path.join(CONTEXT_DIR, 'voice-skill.txt');
  if (!existsSync(voicePath)) {
    throw new Error(`Missing voice profile at ${voicePath}`);
  }
  const voice = readFileSync(voicePath, 'utf8').trim();

  const published = [];
  const pubDir = path.join(CONTEXT_DIR, 'published');
  if (existsSync(pubDir)) {
    let total = 0;
    for (const name of readdirSync(pubDir).filter((f) => /\.(txt|md)$/i.test(f)).sort()) {
      const text = readFileSync(path.join(pubDir, name), 'utf8').trim();
      if (!text || total + text.length > MAX_REFERENCE_CHARS) continue;
      total += text.length;
      published.push({ name, text });
    }
  }

  cached = { voice, published };
  return cached;
}

export function referenceBlock(published) {
  if (!published.length) return '';
  return (
    '\n\n# Published reference pieces (for grounding her voice — do not copy sentences)\n' +
    published.map((p) => `\n--- ${p.name} ---\n${p.text}`).join('\n')
  );
}
