/**
 * One thin transport layer for the configured LLM. Everything that talks
 * to Gemini / an OpenAI-compatible endpoint goes through here, so the
 * assistant and the one-shot form filler share the same key handling,
 * timeouts and error messages.
 *
 * The LLM is only ever used for natural-language understanding. It never
 * touches the court website; the Python scraper does that.
 */

import { LLM } from '../config.js';

export class LlmError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'LlmError';
  }
}

function checkProvider() {
  if (LLM.provider === 'gemini') {
    if (!LLM.gemini.apiKey) throw new LlmError('GEMINI_API_KEY is not set. Add it to your .env file.');
  } else if (LLM.provider === 'openai' || LLM.provider === 'openai_compatible') {
    if (!LLM.openai.apiKey) throw new LlmError('OPENAI_API_KEY is not set. Add it to your .env file.');
  } else {
    throw new LlmError(`Unknown LLM_PROVIDER '${LLM.provider}'. Set it to 'gemini' or 'openai' in your .env file.`);
  }
}

async function postJson(url, payload, headers = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(LLM.timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new LlmError('The AI model took too long to respond. Please try again.', { cause: err });
    }
    throw new LlmError(`Could not reach the AI model: ${err?.message ?? err}`, { cause: err });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LlmError(`AI API error ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

async function gemini(messages, system, jsonMode, temperature) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${LLM.gemini.model}:generateContent`;
  const payload = {
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { temperature },
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  if (jsonMode) payload.generationConfig.responseMimeType = 'application/json';

  const data = await postJson(url, payload, { 'x-goog-api-key': LLM.gemini.apiKey });
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    throw new LlmError(`Unexpected Gemini response shape: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return text;
}

async function openai(messages, system, jsonMode, temperature) {
  const chat = [];
  if (system) chat.push({ role: 'system', content: system });
  chat.push(...messages.map((m) => ({ role: m.role, content: m.content })));

  const payload = { model: LLM.openai.model, messages: chat, temperature };
  if (jsonMode) payload.response_format = { type: 'json_object' };

  const data = await postJson(`${LLM.openai.baseUrl}/chat/completions`, payload, {
    Authorization: `Bearer ${LLM.openai.apiKey}`,
  });
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new LlmError(`Unexpected chat-completions response shape: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return text;
}

/**
 * messages: [{ role: 'user' | 'assistant', content }], oldest first.
 * Returns the model's text. Throws LlmError on any problem.
 */
export async function generate(messages, { system = null, jsonMode = false, temperature = 0.2 } = {}) {
  checkProvider();
  if (LLM.provider === 'gemini') return gemini(messages, system, jsonMode, temperature);
  return openai(messages, system, jsonMode, temperature);
}
