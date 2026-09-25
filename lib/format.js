// Plain-text messages for Telegram (no parse_mode, so the draft copies cleanly).
import { PASS_SCORE } from './pipeline.js';

// Shows what the bot heard, so a mis-transcription is easy to spot.
const heard = (r) => (r.source === 'voice' ? [`Heard: "${r.note.length > 400 ? r.note.slice(0, 400) + '…' : r.note}"`, ''] : []);

export function formatRejection(result) {
  const { screen } = result;
  const lines = [
    `NOT DRAFTED (score ${screen.score}/10, bar is ${PASS_SCORE})`,
    '',
    ...heard(result),
    screen.reasons,
  ];
  if (screen.missing?.length) {
    lines.push('', 'To make it workable, add:', ...screen.missing.map((m) => `- ${m}`));
  }
  lines.push('', result.source === 'voice' ? 'Record a fuller version and I will screen it again.' : 'Send an expanded version of the note and I will screen it again.');
  return lines.join('\n');
}

// Review sheet that goes with the draft. The draft itself goes in a separate message.
export function formatReview(result, id) {
  const { screen, angle, draft, voiceIssues, unverifiedNumbers } = result;
  const version = result.version > 1 ? ` (version ${result.version})` : '';
  const header = {
    approved: ['APPROVED' + version, 'Saved as your final version. Still not posted anywhere. Publishing is up to you.'],
    superseded: ['REPLACED BY A REDRAFT' + version, 'The newer version is further down.'],
  }[result.status] ?? ['DRAFT: WAITING FOR YOUR REVIEW' + version, 'Nothing has been posted or scheduled. Publishing is up to you.'];
  const lines = [
    ...header,
    '',
    ...heard(result),
    `Score: ${screen.score}/10 | ${screen.category} | opens with: ${draft.opening_type}`,
    `Idea: ${screen.core_idea}`,
  ];

  lines.push('');
  if (angle.usable && draft.angle_used) {
    lines.push(`News angle used: ${angle.fact}`);
    if (angle.headline) lines.push(`Headline: ${angle.headline}`);
    lines.push(`Reported by: ${angle.source}${angle.date && angle.date !== 'unknown' ? ` (${angle.date})` : ''}${angle.provider === 'google-news' ? ', via Google News' : ''}`);
    if (!angle.verified) lines.push('Warning: search did not tie this exact sentence to a result. Check the source before keeping it.');
    for (const s of angle.sources) lines.push(`- ${s.title}: ${s.uri}`);
  } else if (angle.usable) {
    lines.push(`News angle found but left out of the draft: ${angle.fact} (${angle.source})`);
  } else if (angle.error) {
    lines.push('News angle: the search step failed this time, so the draft uses only your note.');
  } else {
    lines.push(`News angle: no ${angle.provider === 'google-news' ? 'Google News item fitted this idea' : 'verifiable current item found'}, so the draft uses only your note.`);
  }

  const checks = [...(draft.facts_to_verify ?? [])];
  if (unverifiedNumbers.length) checks.push(`Figures not found in your note or the source: ${unverifiedNumbers.join(', ')}`);
  if (/\[CHECK:/i.test(draft.post)) checks.push('Fill in the [CHECK: ...] placeholders.');
  if (checks.length) lines.push('', 'Check before posting:', ...checks.map((c) => `- ${c}`));

  if (voiceIssues.length) lines.push('', 'Voice flags still present:', ...voiceIssues.map((v) => `- ${v}`));

  if (id) lines.push('', `Draft ${id}. Use the buttons under the draft: Approve, Redraft or Delete.`);
  return lines.join('\n');
}

const STATUS = { awaiting_review: 'waiting', approved: 'approved' };

export function formatDraftList(records) {
  if (!records.length) return 'No saved drafts yet.';
  return [
    'Recent drafts (none posted anywhere):',
    '',
    ...records.map((r) => `${r.id} | ${STATUS[r.status] ?? r.status} | ${r.createdAt.slice(0, 16).replace('T', ' ')} | ${r.screen.score}/10 | ${r.screen.core_idea}`),
    '',
    'Send /draft <id> to see one again with its buttons.',
  ].join('\n');
}
