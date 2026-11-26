// Where answers come from, in order:
//   1. Your own server (llama.cpp on the Oracle Cloud free VM), if LLM_URL is set. No daily limit.
//   2. Cloudflare Workers AI. Free daily allowance; used when the server is slow, down or missing.
//
// generate() returns { name, emoji }, null for "nothing happens", or throws when no provider answered.
// A refusal ("I can't help with that") never becomes an element: the next provider gets a turn, and if
// every provider that answered refused, it throws NoAnswerError so nothing is saved and the pair can be
// tried again later.

import { buildPrompt, isRefusal, parseReply } from './craft.js';

export class NoAnswerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoAnswerError';
  }
}

export async function generate(env, first, second, fetchImpl = fetch) {
  if (env.MOCK_AI === '1') return mockGenerate(first, second);
  const messages = buildPrompt(first, second);
  const errors = [];
  let refusals = 0;

  const providers = [];
  if (env.LLM_URL) providers.push(['self-hosted', () => askSelfHosted(env, messages, fetchImpl)]);
  if (env.AI) providers.push(['workers-ai', () => askWorkersAI(env, messages)]);

  for (const [label, ask] of providers) {
    try {
      const text = await ask();
      if (isRefusal(text)) {
        refusals++;
        errors.push(`${label}: refused (${text.slice(0, 60)})`);
        continue;
      }
      return parseReply(text);
    } catch (err) {
      errors.push(`${label}: ${err?.message ?? err}`);
    }
  }

  const summary = errors.join('; ') || 'no AI provider configured';
  if (refusals > 0 && refusals === errors.length) throw new NoAnswerError(summary);
  throw new Error(summary);
}

/** llama.cpp's llama-server speaks the OpenAI chat API. */
async function askSelfHosted(env, messages, fetchImpl) {
  const res = await fetchImpl(`${env.LLM_URL.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_TOKEN || ''}` },
    body: JSON.stringify({ messages, max_tokens: 24, temperature: 0.5, cache_prompt: true }),
    // A busy or sleeping server shouldn't hold players up: give up and use Workers AI instead.
    signal: AbortSignal.timeout(Number(env.LLM_TIMEOUT_MS || 12000)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('unexpected response shape');
  return text;
}

async function askWorkersAI(env, messages) {
  const out = await env.AI.run(env.MODEL || '@cf/meta/llama-3.2-3b-instruct', {
    messages,
    max_tokens: 24,
    temperature: 0.5,
    ...modelOptions(env),
  });
  return workersAIText(out);
}

/** Extra per-model request options from MODEL_OPTIONS (JSON), e.g. turning a reasoning model's thinking off. */
export function modelOptions(env) {
  if (!env.MODEL_OPTIONS) return {};
  try {
    const opts = JSON.parse(env.MODEL_OPTIONS);
    return opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  } catch {
    console.warn('MODEL_OPTIONS is not valid JSON; ignoring it');
    return {};
  }
}

/** Workers AI models answer in one of two shapes: { response } or OpenAI-style { choices }. */
export function workersAIText(out) {
  if (typeof out?.response === 'string') return out.response;
  const content = out?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  throw new Error('unexpected response shape');
}

// Local testing without any AI: MOCK_AI=1 (see the [env.mock] section of wrangler.toml).
function mockGenerate(first, second) {
  if (first.toLowerCase() === second.toLowerCase() && first.toLowerCase() === 'air') return null;
  const name = `${first.slice(0, Math.ceil(first.length / 2))}${second.slice(Math.floor(second.length / 2))}`;
  return { name: name.charAt(0).toUpperCase() + name.slice(1).toLowerCase(), emoji: '🧪' };
}
