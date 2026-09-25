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

export const isTransient = (err) => [429, 500, 503, 504].includes(err?.status ?? err?.code);

// Time budget for the current request. The edge function is killed at 150s with no chance to reply,
// so every Gemini call and wait must fit inside the deadline set by withBudget().
const budget = new AsyncLocalStorage();
export const withBudget = (ms, fn) => {
  const outer = budget.getStore()?.deadline ?? Infinity;
  return budget.run({ deadline: Math.min(outer, Date.now() + ms) }, fn);
};
const remaining = () => (budget.getStore()?.deadline ?? Infinity) - Date.now();
const outOfTime = (lastErr) =>
  Object.assign(new Error(`ran out of time waiting for Gemini${lastErr ? ` (last error: ${String(lastErr.message).slice(0, 120)})` : ''}`), { status: 504 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function withFallback(primary, fn) {
  const models = [primary, ...FALLBACKS.filter((m) => m !== primary)];
  let lastErr;
  // Two passes over the model list: overload spikes usually clear within seconds.
  for (let pass = 1; pass <= 2; pass++) {
    for (const model of models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const left = remaining();
        if (left < 5_000) throw outOfTime(lastErr);
        try {
          return await fn(model, Math.min(60_000, left - 2_000));
        } catch (err) {
          lastErr = err;
          if (!isTransient(err) && (err?.status ?? err?.code) !== 404) throw err;
          const msg = String(err?.message ?? '');
          const hinted = Number(msg.match(/retry in ([\d.]+)s/i)?.[1]);
          // Only wait out a 429 when the server says it clears soon; otherwise another model is faster.
          if (attempt === 1 && err.status === 429 && hinted && hinted <= 15 && remaining() > hinted * 1000 + 15_000) {
            console.error(`gemini ${model} 429, retrying in ${Math.ceil(hinted)}s`);
            await pause(hinted * 1000 + 500);
            continue;
          }
          console.error(`gemini ${model} ${/PerDay/i.test(msg) ? 'daily quota used up' : err.status}, trying next model`);
          break;
        }
      }
    }
    if (pass === 1) {
      if (remaining() < 25_000) break;
      console.error('all models busy, waiting 10s for another pass');
      await pause(10_000);
    }
  }
  throw lastErr;
}

export async function generateJSON({ model, system, prompt, schema, temperature = 0.4 }) {
  const res = await withFallback(model, (m, timeout) =>
    ai().models.generateContent({
      model: m,
      contents: prompt,
      config: {
        httpOptions: { timeout },
        systemInstruction: system,
        ...temp(m, temperature),
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    }),
  );
  const text = res.text;
  if (!text) throw new Error(`Empty response from ${model}`);
  return JSON.parse(text);
}

// Google Search grounding. Returns the model text plus the real sources Search returned,
// so nothing downstream has to trust a URL or publication name the model typed itself.
export async function generateGrounded({ model, system, prompt, temperature = 0.2 }) {
  const res = await withFallback(model, (m, timeout) =>
    ai().models.generateContent({
      model: m,
      contents: prompt,
      config: { httpOptions: { timeout }, systemInstruction: system, ...temp(m, temperature), tools: [{ googleSearch: {} }] },
    }),
  );
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
  });
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.audioTranscription?.text ?? p.text ?? '').join(' ').replace(/\s+/g, ' ').trim();
}
