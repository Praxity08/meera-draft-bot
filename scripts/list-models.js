// Lists Gemini models this API key can call generateContent on.
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
for await (const m of await ai.models.list()) {
  if (m.supportedActions?.includes('generateContent')) console.log(m.name.replace('models/', ''));
}
