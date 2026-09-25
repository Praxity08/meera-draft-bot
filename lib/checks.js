// Deterministic checks that don't depend on the model grading itself.

// The "never uses" list from voice-skill.txt, plus the CTA/engagement-bait it rules out.
const BANNED = [
  'game-changer', 'game changer', 'obsessed', 'holy grail', 'glow up', 'glow-up',
  'skin journey', 'self-care', 'must-have', 'life-changing', 'amazing', 'love this',
  'literally', 'ultimate',
];
const SUPERLATIVES = ['best', 'perfect'];
const CTA = [
  'let me know', 'follow for more', 'link in bio', 'dm me', 'shop now', 'comment below',
  'drop a comment', 'share your thoughts', 'what do you think', 'tag someone', 'repost',
];

export function lintVoice(post) {
  const issues = [];
  const lower = post.toLowerCase();

  if (/\p{Extended_Pictographic}/u.test(post)) issues.push('contains emoji');
  if (/(^|\s)#[\p{L}\d_]+/u.test(post)) issues.push('contains hashtag');
  if (post.includes('!')) issues.push('contains exclamation point');

  for (const w of BANNED) if (new RegExp(`\\b${w}\\b`, 'i').test(post)) issues.push(`uses "${w}"`);
  for (const w of SUPERLATIVES) if (new RegExp(`\\b${w}\\b`, 'i').test(post)) issues.push(`uses superlative "${w}"`);
  for (const p of CTA) if (lower.includes(p)) issues.push(`CTA/engagement bait: "${p}"`);

  const firstSentence = post.trim().split(/(?<=[.?!])\s/)[0] ?? '';
  if (firstSentence.trim().endsWith('?')) issues.push('opens with a question');

  return issues;
}

// Every figure in the draft should trace back to the note, the sourced angle, or her own
// profile/published pieces. Anything else is flagged for Meera to verify before posting.
// Bracketed [CHECK: ...] placeholders are intentional gaps and are skipped.
export function unsupportedNumbers(post, sources) {
  const body = post.replace(/\[CHECK:[^\]]*\]/gi, ' ');
  const haystack = normalizeNumbers(sources.join('\n'));
  const found = new Set();
  for (const m of body.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = m[0].replace(/,/g, '').replace(/\.$/, '');
    if (!haystack.has(n)) found.add(m[0]);
  }
  return [...found];
}

function normalizeNumbers(text) {
  return new Set([...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '')));
}

// Parses the line-oriented reply from the grounded search step.
export function parseAngle(text) {
  const field = (name) => {
    const m = text.match(new RegExp(`^\\s*\\**${name}\\**\\s*:\\**\\s*(.+)$`, 'im'));
    return m ? m[1].trim() : '';
  };
  return {
    found: /^yes/i.test(field('FOUND')),
    fact: field('FACT'),
    source: field('SOURCE'),
    date: field('DATE'),
    relevance: field('RELEVANCE'),
  };
}

// Picks the search results that actually back the fact sentence, via grounding supports.
export function sourcesForFact(fact, chunks, supports) {
  const f = fact.toLowerCase();
  const idx = new Set();
  for (const s of supports) {
    const seg = s.text.toLowerCase().trim();
    if (seg && (f.includes(seg) || seg.includes(f))) s.chunkIndices.forEach((i) => idx.add(i));
  }
  const picked = [...idx].map((i) => chunks[i]).filter((c) => c?.uri);
  return { sources: dedupe(picked), matched: picked.length > 0 };
}

function dedupe(chunks) {
  const seen = new Set();
  return chunks.filter((c) => !seen.has(c.uri) && seen.add(c.uri));
}
