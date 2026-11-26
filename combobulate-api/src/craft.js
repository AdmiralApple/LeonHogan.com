// Pure helpers for Combobulate: no Cloudflare APIs here, so they can be unit tested with `node --test`.

export const MAX_NAME = 32;

/** Lowercase lookup key for an element name ("  Hot  Dog " -> "hot dog"). */
export function toKey(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Sorted pair of keys, so A+B and B+A are the same recipe. */
export function pairKeys(a, b) {
  const ka = toKey(a);
  const kb = toKey(b);
  return ka <= kb ? [ka, kb] : [kb, ka];
}

const EMOJI_RE = /\p{Extended_Pictographic}(?:\u{FE0F}|\u{20E3}|[\u{1F3FB}-\u{1F3FF}]|\u{200D}\p{Extended_Pictographic}\u{FE0F}?)*/u;

/** First emoji in a string, or null. */
export function firstEmoji(text) {
  const m = String(text ?? '').match(EMOJI_RE);
  return m ? m[0] : null;
}

/**
 * Turn the model's raw reply into { name, emoji }, or null when the reply means "nothing".
 * Expected shape: "Steam | ♨️", but small models wander, so this is forgiving.
 */
export function parseReply(raw) {
  let line = String(raw ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;

  // Drop chatter like "Result:" or "A + B =".
  line = line.replace(/^(result|answer|output)\s*[:=-]\s*/i, '');
  if (line.includes('=')) line = line.slice(line.lastIndexOf('=') + 1);

  const emoji = firstEmoji(line) ?? '✨';
  let name = (line.includes('|') ? line.split('|')[0] : line)
    .replace(new RegExp(EMOJI_RE.source, 'gu'), '')
    .replace(/[*_`"“”‘’]/g, '')
    .replace(/[^\p{L}\p{N}' &.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\-&' ]+$/u, '')
    .replace(/^[.\-&' ]+/u, '');

  if (!name || /^(nothing|none|n\/a|null)$/i.test(name)) return null;
  if (name.length > MAX_NAME) {
    name = name.slice(0, MAX_NAME).replace(/\s+\S*$/, '').trim() || name.slice(0, MAX_NAME);
  }
  // Title-case replies that came back all lowercase ("hot dog" -> "Hot Dog").
  if (name === name.toLowerCase()) name = name.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
  return { name, emoji };
}

const REFUSAL_RE =
  /\b(i can['’]?t|i cannot|i can not|i won['’]?t|i'?m not able|i am not able|i'?m unable|i am unable|unable to (help|assist|provide|create|generate)|as an ai|i apologi[sz]e|sorry|not appropriate|inappropriate|i must decline|i (will|must) not|against (my|the) (guidelines|polic)|i don['’]?t feel comfortable|i'?d rather not)\b/i;

/** True when the model declined instead of naming a thing ("I can't create content that..."). */
export function isRefusal(raw) {
  return REFUSAL_RE.test(String(raw ?? ''));
}

/** Chat messages sent to the model for one pair. */
export function buildPrompt(first, second) {
  const system =
    'You are the engine of a word-combining sandbox game for adults. The player smashes two things together and you say what they make. ' +
    'Reply with exactly one line: the result (1 to 3 words, Title Case), then " | ", then one emoji that fits it. ' +
    'Results can be objects, materials, creatures, places, people, concepts or well-known pop-culture things. ' +
    'Dark, violent, crude, adult, edgy or controversial results are allowed whenever they are the logical result. ' +
    'It is only a word game: never refuse, never warn, never moralize, always name a thing. ' +
    'Be logical first and playful second. Never just repeat one of the inputs unless nothing else makes sense. No explanations.';
  const shots = [
    ['Water', 'Fire', 'Steam | ♨️'],
    ['Earth', 'Water', 'Mud | 🟤'],
    ['Fire', 'Earth', 'Lava | 🌋'],
    ['Human', 'Poison', 'Murder | 🔪'],
    ['Plant', 'Time', 'Tree | 🌳'],
    ['Beer', 'Human', 'Drunk | 🍺'],
    ['Steam', 'Engine', 'Train | 🚂'],
  ];
  const messages = [{ role: 'system', content: system }];
  for (const [a, b, out] of shots) {
    messages.push({ role: 'user', content: `${a} + ${b}` });
    messages.push({ role: 'assistant', content: out });
  }
  messages.push({ role: 'user', content: `${first} + ${second}` });
  return messages;
}

/** Element names a client may send: short, printable, no control characters. */
export function isValidInput(name) {
  const s = String(name ?? '');
  return s.trim().length > 0 && s.length <= MAX_NAME + 8 && !/[\p{Cc}<>]/u.test(s);
}
