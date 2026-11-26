import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/providers.js';

const okServer = (content) => async (url, init) => {
  okServer.last = { url, init };
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
};
const downServer = async () => {
  throw new TypeError('fetch failed');
};
const errorServer = async () => new Response('busy', { status: 503 });
const workersAI = (response) => ({ run: async () => ({ response }) });
const brokenAI = { run: async () => { throw new Error('daily allocation exceeded'); } };

test('uses your server first when LLM_URL is set', async () => {
  const env = { LLM_URL: 'https://llm.example/', LLM_TOKEN: 'secret', AI: workersAI('Wrong | ❌') };
  const r = await generate(env, 'Water', 'Fire', okServer('Steam | ♨️'));
  assert.deepEqual(r, { name: 'Steam', emoji: '♨️' });
  assert.equal(okServer.last.url, 'https://llm.example/v1/chat/completions');
  assert.equal(okServer.last.init.headers.authorization, 'Bearer secret');
  const body = JSON.parse(okServer.last.init.body);
  assert.equal(body.messages.at(-1).content, 'Water + Fire');
});

test('falls back to Workers AI when your server is down', async () => {
  const env = { LLM_URL: 'https://llm.example', AI: workersAI('Mud | 🟤') };
  assert.deepEqual(await generate(env, 'Earth', 'Water', downServer), { name: 'Mud', emoji: '🟤' });
});

test('falls back to Workers AI when your server errors', async () => {
  const env = { LLM_URL: 'https://llm.example', AI: workersAI('Mud | 🟤') };
  assert.deepEqual(await generate(env, 'Earth', 'Water', errorServer), { name: 'Mud', emoji: '🟤' });
});

test('skips your server when LLM_URL is empty', async () => {
  let called = false;
  const env = { LLM_URL: '', AI: workersAI('Lava | 🌋') };
  const r = await generate(env, 'Fire', 'Earth', async () => { called = true; });
  assert.deepEqual(r, { name: 'Lava', emoji: '🌋' });
  assert.equal(called, false);
});

test('throws when every provider fails, so nothing gets saved', async () => {
  const env = { LLM_URL: 'https://llm.example', AI: brokenAI };
  await assert.rejects(generate(env, 'Fire', 'Earth', downServer), /self-hosted.*workers-ai/);
});

test('"nothing" from your server is an answer, not a failure', async () => {
  const env = { LLM_URL: 'https://llm.example', AI: brokenAI };
  assert.equal(await generate(env, 'Air', 'Air', okServer('Nothing')), null);
});

test('a refusal from your server falls through to Workers AI', async () => {
  const env = { LLM_URL: 'https://llm.example', AI: workersAI('Arsonist | 🔥') };
  const r = await generate(env, 'Human', 'Fire', okServer("I can't help with that."));
  assert.deepEqual(r, { name: 'Arsonist', emoji: '🔥' });
});

test('when every model refuses, nothing is saved (NoAnswerError)', async () => {
  const env = { LLM_URL: 'https://llm.example', AI: workersAI('I cannot create that content.') };
  await assert.rejects(generate(env, 'Human', 'Fire', okServer('Sorry, I must decline.')), { name: 'NoAnswerError' });
});

test('refusal plus outage is an outage, not a no-answer', async () => {
  const env = { LLM_URL: 'https://llm.example', AI: brokenAI };
  await assert.rejects(generate(env, 'Human', 'Fire', okServer("I can't do that.")), (e) => e.name !== 'NoAnswerError');
});
