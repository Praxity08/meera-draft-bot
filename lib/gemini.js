// Thin wrapper over the Gemini SDK: structured JSON calls and search-grounded calls.
import { GoogleGenAI } from '@google/genai';
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from './env.js';

export const SCREEN_MODEL = env('GEMINI_SCREEN_MODEL') || 'gemini-3.7-flash';
export const DRAFT_MODEL = env('GEMINI_DRAFT_MODEL') || 'gemini-3.8-flash';
export const TRANSCRIBE_MODEL = env('GEMINI_TRANSCRIBE_MODEL') || 'gemini-3.5-transcribe';

// Google recommends leaving Gemini 3+ at its default temperature; lower values can cause looping.
const temp = (model, t) => (/^gemini-[3-9]/.test(model) ? {} : { temperature: t });

let client;
function ai() {
  if (!env('GEMINI_API_KEY')) throw new Error('GEMINI_API_KEY is not set');
  client ??= new GoogleGenAI({ apiKey: env('GEMINI_API_KEY') });
  return client;
}

// Each model has its own capacity and (on the free tier) its own daily quota, so on overload
// (503) or a rate limit move to the next model. Waits stay short: the edge function has 150s.
const FALLBACKS = (env('GEMINI_FALLBACK_MODELS') ?? 'gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash').split(',').map((m) => m.trim()).filter(Boolean);

// A call cancelled by our own timeout (AbortSignal) is treated like an overloaded model: try the next one.
const isAbort = (err) => err?.name === 'AbortError' || err?.name === 'TimeoutError' || /signal (has been|is) aborted|aborted|timed? ?out/i.test(String(err?.message ?? ''));
export const isTransient = (err) => [429, 500, 503, 504].includes(err?.status ?? err?.code) || isAbort(err);

// Time budget for the current request. The edge function is killed at 150s with no chance to reply,
// so every Gemini call and wait must fit inside the deadline set by withBudget().
const budget = new AsyncLocalStorage();
export const withBudget = (ms, fn) => {
  const outer = budget.getStore();
  return budget.run({
    deadline: Math.min(outer?.deadline ?? Infinity, Date.now() + ms),
    trace: outer?.trace ?? [],
    started: outer?.started ?? Date.now(),
  }, fn);
};
// Step-by-step record of Gemini calls for the current request, saved to bot_events for diagnosis.
export const currentTrace = () => budget.getStore()?.trace ?? [];
const note = (line) => {
  const store = budget.getStore();
  if (store) store.trace.push(`${((Date.now() - store.started) / 1000).toFixed(1)}s ${line}`);
  console.error(line);
};
const remaining = () => (budget.getStore()?.deadline ?? Infinity) - Date.now();
const outOfTime = (lastErr) =>
  Object.assign(new Error(`ran out of time waiting for Gemini${lastErr ? ` (last error: ${String(lastErr.message).slice(0, 120)})` : ''}`), { status: 504 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function withFallback(primary, fn, { singleTry = false, label = 'call', maxCallMs = 45_000 } = {}) {
  const models = singleTry ? [primary] : [primary, ...FALLBACKS.filter((m) => m !== primary)];
  let lastErr;
  // Two passes over the model list: overload spikes usually clear within seconds.
  for (let pass = 1; pass <= 2; pass++) {
    for (const model of models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const left = remaining();
        if (left < 5_000) { note(`${label}: out of time`); throw outOfTime(lastErr); }
        const t0 = Date.now();
        try {
          const res = await fn(model, Math.min(maxCallMs, left - 2_000));
          note(`${label} ${model} ok ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          return res;
        } catch (err) {
          note(`${label} ${model} failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err?.status ?? err?.name ?? ''} ${String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 90)}`);
          lastErr = err;
          if (!isTransient(err) && (err?.status ?? err?.code) !== 404) throw err;
          if (singleTry) throw err;
          const msg = String(err?.message ?? '');
          const hinted = Number(msg.match(/retry in ([\d.]+)s/i)?.[1]);
          // Only wait out a 429 when the server says it clears soon; otherwise another model is faster.
          if (attempt === 1 && err.status === 429 && hinted && hinted <= 15 && remaining() > hinted * 1000 + 15_000) {
            note(`gemini ${model} 429, retrying in ${Math.ceil(hinted)}s`);
            await pause(hinted * 1000 + 500);
            continue;
          }
          
          break;
        }
      }
    }
    if (pass === 1) {
      if (remaining() < 25_000) break;
      note('all models busy, waiting 10s for another pass');
      await pause(10_000);
    }
  }
  throw lastErr;
}

export async function generateJSON({ model, system, prompt, schema, temperature = 0.4, thinking, label = 'json' }) {
  const res = await withFallback(model, (m, timeout) =>
    ai().models.generateContent({
      model: m,
      contents: prompt,
      config: {
        httpOptions: { timeout },
        systemInstruction: system,
        ...temp(m, temperature),
        ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    }),
  { label });
  const text = res.text;
  if (!text) throw new Error(`Empty response from ${model}`);
  return JSON.parse(text);
}

// Google Search grounding. Returns the model text plus the real sources Search returned,
// so nothing downstream has to trust a URL or publication name the model typed itself.
// One attempt only: on this key every model has shared the same search quota, so cycling through
// fallbacks just burns the per-minute allowance that drafting needs next.
export async function generateGrounded({ model, system, prompt, temperature = 0.2 }) {
  const res = await withFallback(model, (m, timeout) =>
    ai().models.generateContent({
      model: m,
      contents: prompt,
      config: { httpOptions: { timeout }, systemInstruction: system, ...temp(m, temperature), thinkingConfig: { thinkingLevel: 'LOW' }, tools: [{ googleSearch: {} }] },
    }),
  { singleTry: true, label: 'search' });
  const meta = res.candidates?.[0]?.groundingMetadata ?? {};
  const chunks = (meta.groundingChunks ?? []).map((c) => ({
    title: c.web?.title ?? '',
    uri: c.web?.uri ?? '',
  }));
  const supports = (meta.groundingSupports ?? []).map((s) => ({
    text: s.segment?.text ?? '',
    chunkIndices: s.groundingChunkIndices ?? [],
  }));
  return { text: res.text ?? '', chunks, supports, queries: meta.webSearchQueries ?? [] };
}

// Speech-to-text for voice notes. The dedicated transcribe model returns audioTranscription parts;
// if it's unavailable, the general Flash models transcribe from a prompt instead.
export async function transcribeAudio({ data, mimeType, languageCodes = [], vocabulary = [] }) {
  const res = await withFallback(TRANSCRIBE_MODEL, (m, timeout) => {
    const dedicated = /transcribe/.test(m);
    const parts = [{ inlineData: { mimeType, data } }];
    if (!dedicated) {
      parts.push({ text: `Transcribe this voice note verbatim, in the language(s) spoken. Do not translate, summarise, correct, or add anything. Output only the transcript, or [no speech] if there is no speech. Terms that may come up: ${vocabulary.join(', ')}.` });
    }
    return ai().models.generateContent({
      model: m,
      contents: [{ role: 'user', parts }],
      config: {
        httpOptions: { timeout },
        ...(dedicated ? { audioTranscriptionConfig: { languageCodes, customVocabulary: vocabulary } } : {}),
      },
    });
  }, { label: 'transcribe', maxCallMs: 30_000 });
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.audioTranscription?.text ?? p.text ?? '').join(' ').replace(/\s+/g, ' ').trim();
}
