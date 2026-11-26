import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, isValidInput, pairKeys, parseReply, toKey } from '../src/craft.js';

test('keys ignore case, spacing and order', () => {
  assert.equal(toKey('  Hot   Dog '), 'hot dog');
  assert.deepEqual(pairKeys('Water', 'fire'), ['fire', 'water']);
  assert.deepEqual(pairKeys('fire', 'Water'), ['fire', 'water']);
});

test('parses the expected format', () => {
  assert.deepEqual(parseReply('Steam | ♨️'), { name: 'Steam', emoji: '♨️' });
  assert.deepEqual(parseReply('Hot Dog | 🌭\nextra text'), { name: 'Hot Dog', emoji: '🌭' });
});

test('forgives small-model chatter', () => {
  assert.deepEqual(parseReply('Result: **Volcano** 🌋'), { name: 'Volcano', emoji: '🌋' });
  assert.deepEqual(parseReply('Fire + Water = steam | ♨️'), { name: 'Steam', emoji: '♨️' });
  assert.deepEqual(parseReply('"Rainbow."'), { name: 'Rainbow', emoji: '✨' });
  assert.deepEqual(parseReply('Family 👨‍👩‍👧 | 👨‍👩‍👧'), { name: 'Family', emoji: '👨‍👩‍👧' });
});

test('nothing-ish replies become null', () => {
  assert.equal(parseReply(''), null);
  assert.equal(parseReply('Nothing'), null);
  assert.equal(parseReply('   \n  '), null);
  assert.equal(parseReply('🔥'), null);
});

test('long names are trimmed at a word boundary', () => {
  const r = parseReply('The Extremely Long Name Of A Very Specific Thing | 🧵');
  assert.ok(r.name.length <= 32, r.name);
  assert.ok(!r.name.endsWith(' '));
});

test('input validation', () => {
  assert.equal(isValidInput('Water'), true);
  assert.equal(isValidInput(''), false);
  assert.equal(isValidInput(null), false);
  assert.equal(isValidInput('<script>'), false);
  assert.equal(isValidInput('x'.repeat(100)), false);
});

test('prompt ends with the pair being asked', () => {
  const m = buildPrompt('Lava', 'Ice');
  assert.equal(m[0].role, 'system');
  assert.deepEqual(m.at(-1), { role: 'user', content: 'Lava + Ice' });
});

test('spots refusals so they never become elements', async () => {
  const { isRefusal } = await import('../src/craft.js');
  for (const r of [
    "I can't create content that promotes violence.",
    'I cannot help with that request.',
    "I'm not able to provide that.",
    'Sorry, but I must decline.',
    'As an AI, I don’t feel comfortable with this.',
    'That combination is inappropriate.',
  ]) assert.equal(isRefusal(r), true, r);
  for (const ok of ['Steam | ♨️', 'Murder | 🔪', 'Drunk | 🍺', 'Ice Cream | 🍦', 'Cannon | 💣', 'Sorcerer | 🧙'])
    assert.equal(isRefusal(ok), false, ok);
});

test('prompt allows mature results', () => {
  const sys = buildPrompt('A', 'B')[0].content;
  assert.match(sys, /never refuse/i);
  assert.doesNotMatch(sys, /family friendly/i);
});
