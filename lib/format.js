// Plain-text messages for Telegram (no parse_mode, so the draft copies cleanly).
import { PASS_SCORE } from './pipeline.js';

export function formatRejection({ screen }) {
  const lines = [
    `NOT DRAFTED (score ${screen.score}/10, bar is ${PASS_SCORE})`,
    '',
    screen.reasons,
  ];
  if (screen.missing?.length) {
    lines.push('', 'To make it workable, add:', ...screen.missing.map((m) => `- ${m}`));
  }
  lines.push('', 'Send an expanded version of the note and I will screen it again.');
  return lines.join('\n');
}

// Review sheet that goes with the draft. The draft itself goes in a separate message.
export function formatReview(result, id) {
  const { screen, angle, draft, voiceIssues, unverifiedNumbers } = result;
  const lines = [
    'DRAFT: WAITING FOR YOUR REVIEW',
    'Nothing has been posted or scheduled. Publishing is up to you.',
    '',
    `Score: ${screen.score}/10 | ${screen.category} | opens with: ${draft.opening_type}`,
    `Idea: ${screen.core_idea}`,
  ];

  lines.push('');
  if (angle.usable && draft.angle_used) {
    lines.push(`News angle used: ${angle.fact}`);
    lines.push(`Reported by: ${angle.source}${angle.date && angle.date !== 'unknown' ? ` (${angle.date})` : ''}`);
    if (!angle.verified) lines.push('Warning: search did not tie this exact sentence to a result. Check the source before keeping it.');
    for (const s of angle.sources) lines.push(`- ${s.title}: ${s.uri}`);
  } else if (angle.usable) {
    lines.push(`News angle found but left out of the draft: ${angle.fact} (${angle.source})`);
  } else {
    lines.push('News angle: no verifiable current item found, so the draft uses only your note.');
  }

  const checks = [...(draft.facts_to_verify ?? [])];
  if (unverifiedNumbers.length) checks.push(`Figures not found in your note or the source: ${unverifiedNumbers.join(', ')}`);
  if (/\[CHECK:/i.test(draft.post)) checks.push('Fill in the [CHECK: ...] placeholders.');
  if (checks.length) lines.push('', 'Check before posting:', ...checks.map((c) => `- ${c}`));

  if (voiceIssues.length) lines.push('', 'Voice flags still present:', ...voiceIssues.map((v) => `- ${v}`));

  if (id) lines.push('', `Saved as draft ${id}. /drafts lists recent ones.`);
  return lines.join('\n');
}

export function formatDraftList(records) {
  if (!records.length) return 'No saved drafts yet.';
  return [
    'Recent drafts (all waiting for your review, none posted):',
    '',
    ...records.map((r) => `${r.id} | ${r.createdAt.slice(0, 16).replace('T', ' ')} | ${r.screen.score}/10 | ${r.screen.core_idea}`),
    '',
    'Send /draft <id> to see one again.',
  ].join('\n');
}
