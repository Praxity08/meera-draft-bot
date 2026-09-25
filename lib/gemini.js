// Thin wrapper over the Gemini SDK: structured JSON calls and search-grounded calls.
import { GoogleGenAI } from '@google/genai';

export const SCREEN_MODEL = process.env.GEMINI_SCREEN_MODEL || 'gemini-3.7-flash';
export const DRAFT_MODEL = process.env.GEMINI_DRAFT_MODEL || 'gemini-3.8-flash';

// Google recommends leaving Gemini 3+ at its default temperature; lower values can cause looping.
const temp = (model, t) => (/^gemini-[3-9]/.test(model) ? {} : { temperature: t });

let client;
function ai() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

// Each model has its own capacity and (on the free tier) its own daily quota, so on overload
// (503) or an exhausted daily quota move to the next model. On per-minute limits, wait as asked.
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash').split(',').map((m) => m.trim()).filter(Boolean);

export const isTransient = (err) => [429, 500, 503].includes(err?.status ?? err?.code);

async function withFallback(primary, fn) {
  const models = [primary, ...FALLBACKS.filter((m) => m !== primary)];
  let lastErr;
  // Two passes over the model list: overload spikes usually clear within seconds.
  for (let pass = 1; pass <= 2; pass++) {
    for (const model of models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await fn(model);
        } catch (err) {
          lastErr = err;
          if (!isTransient(err) && (err?.status ?? err?.code) !== 404) throw err;
          const msg = String(err?.message ?? '');
          const hinted = Number(msg.match(/retry in ([\d.]+)s/i)?.[1]);
          // Only wait out a 429 when the server says it clears soon; otherwise another model is faster.
          if (attempt === 1 && err.status === 429 && hinted && hinted <= 30) {
            console.error(`gemini ${model} 429, retrying in ${Math.ceil(hinted)}s`);
            await new Promise((r) => setTimeout(r, hinted * 1000 + 500));
            continue;
          }
          console.error(`gemini ${model} ${/PerDay/i.test(msg) ? 'daily quota used up' : err.status}, trying next model`);
          break;
        }
      }
    }
    if (pass === 1) {
      console.error('all models busy, waiting 20s for another pass');
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
  throw lastErr;
}

export async function generateJSON({ model, system, prompt, schema, temperature = 0.4 }) {
  const res = await withFallback(model, (m) =>
    ai().models.generateContent({
      model: m,
      contents: prompt,
      config: {
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
  const res = await withFallback(model, (m) =>
    ai().models.generateContent({
      model: m,
      contents: prompt,
      config: { systemInstruction: system, ...temp(m, temperature), tools: [{ googleSearch: {} }] },
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
