// Voice notes → text. Telegram voice messages are OGG/Opus; audio files keep their own type.
import { Buffer } from 'node:buffer';
import { downloadFile } from './telegram.js';
import { transcribeAudio } from './gemini.js';

export const MAX_AUDIO_SECONDS = 20 * 60;

// Meera speaks English with Indian-language words mixed in; hints help, detection still runs.
const LANGUAGES = ['en-IN', 'hi-IN', 'ml-IN'];
// Her vocabulary, so the terms she relies on are spelled right.
const VOCABULARY = [
  'Skinstinct', 'niacinamide', 'L-ascorbic acid', 'ascorbic acid', 'INCI', 'CoA', 'certificate of analysis',
  'PAO', 'SPF', 'in vivo', 'in vitro', 'pH', 'formulation', 'bioavailable', 'stability testing', 'retinol',
  'ceramides', 'hyaluronic acid', 'CDSCO', 'BIS',
];

// Gemini names some types differently from what Telegram reports.
const MIME = { 'audio/mpeg': 'audio/mp3', 'audio/x-wav': 'audio/wav', 'audio/x-m4a': 'audio/aac', 'audio/mp4': 'audio/aac' };

// Returns the audio attachment on a message, or null.
export function audioOf(msg) {
  const a = msg.voice ?? msg.audio ?? (msg.document?.mime_type?.startsWith('audio/') ? msg.document : null);
  if (!a) return null;
  const mimeType = a.mime_type || 'audio/ogg';
  return { fileId: a.file_id, mimeType: MIME[mimeType] ?? mimeType, duration: a.duration ?? null, size: a.file_size ?? null };
}

export async function transcribe(audio) {
  const bytes = await downloadFile(audio.fileId);
  const text = await transcribeAudio({
    data: Buffer.from(bytes).toString('base64'),
    mimeType: audio.mimeType,
    languageCodes: LANGUAGES,
    vocabulary: VOCABULARY,
  });
  return /^\[?no speech\]?$/i.test(text) ? '' : text;
}
