// Thin wrapper over the Gemini SDK: structured JSON calls and search-grounded calls.
import { GoogleGenAI } from '@google/genai';

export const SCREEN_MODEL = process.env.GEMINI_SCREEN_MODEL || 'gemini-2.5-flash';
export const DRAFT_MODEL = process.env.GEMINI_DRAFT_MODEL || 'gemini-2.5-flash';

let client;
function ai() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

async function withRetry(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? err?.code;
      const retryable = status === 429 || status === 500 || status === 503;
      if (!retryable || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

export async function generateJSON({ model, system, prompt, schema, temperature = 0.4 }) {
  const res = await withRetry(() =>
    ai().models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: system,
        temperature,
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
  const res = await withRetry(() =>
    ai().models.generateContent({
      model,
      contents: prompt,
      config: { systemInstruction: system, temperature, tools: [{ googleSearch: {} }] },
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
