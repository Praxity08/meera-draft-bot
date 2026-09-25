// Run the pipeline locally on one note, without Telegram.
//   npm run try -- "note text"      npm run try -- samples/strong-note.txt      echo "..." | npm run try
import { readFileSync, existsSync } from 'node:fs';
import { runPipeline } from '../lib/pipeline.js';
import { formatRejection, formatReview } from '../lib/format.js';
import { saveDraft } from '../lib/store.js';

const arg = process.argv.slice(2).join(' ').trim();
const note = arg ? (existsSync(arg) ? readFileSync(arg, 'utf8') : arg) : readFileSync(0, 'utf8');
if (!note.trim()) {
  console.error('Usage: npm run try -- "<note text>" | <file>');
  process.exit(1);
}

const t0 = Date.now();
const result = await runPipeline(note.trim(), { onStage: (s) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`) });
console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] done\n`);

if (result.status === 'rejected') {
  console.log(formatRejection(result));
} else {
  const id = await saveDraft('local', result);
  console.log(formatReview(result, id));
  console.log('\n----- DRAFT -----\n');
  console.log(result.draft.post);
}
