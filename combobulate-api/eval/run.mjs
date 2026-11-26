// Compare models/prompts on a fixed set of pairs. Needs eval/worker.js running on :8791 (see wrangler.toml).
//   node eval/run.mjs                 -> prints a table and writes eval/results.md
import { writeFileSync } from 'node:fs';

const BASE = process.env.EVAL_URL || 'http://localhost:8791';

// [first, second, what most people would expect]
const PAIRS = [
  ['Fire', 'Mud', 'Brick'], ['Fire', 'Clay', 'Pottery/Brick'], ['Fire', 'Sand', 'Glass'], ['Air', 'Fire', 'Energy/Smoke'],
  ['Earth', 'Earth', 'Mountain/Land'], ['Fire', 'Fire', 'Inferno'], ['Air', 'Air', 'Wind'], ['Steam', 'Steam', 'Cloud'],
  ['Cloud', 'Water', 'Rain'], ['Lava', 'Water', 'Obsidian/Stone'], ['Stone', 'Fire', 'Metal'], ['Metal', 'Fire', 'Sword/Forge'],
  ['Plant', 'Water', 'Algae/Growth'], ['Life', 'Earth', 'Human/Animal'], ['Human', 'Fire', 'Cooking/Burn'], ['Sand', 'Water', 'Beach'],
  ['Mud', 'Plant', 'Swamp'], ['Human', 'Knife', 'Murder'], ['Coal', 'Pressure', 'Diamond'], ['Tree', 'Fire', 'Charcoal'],
  ['Wind', 'Water', 'Wave'], ['Rain', 'Sun', 'Rainbow'], ['Fog', 'Mist', 'Cloud'], ['Pot', 'Ship', 'Cauldron?'],
  ['Human', 'Human', 'Family/Love'], ['Bird', 'Metal', 'Airplane'],
];

// Reasoning models think out loud first (slow, costly); this turns that off.
const NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

// [label, model, prompt version, neurons per M input, per M output, extra request options]
const VARIANTS = [
  ['3B (now)', '@cf/meta/llama-3.2-3b-instruct', 'v1', 4625, 30475],
  ['3B new prompt', '@cf/meta/llama-3.2-3b-instruct', 'v2', 4625, 30475],
  ['8B fast', '@cf/meta/llama-3.1-8b-instruct-fp8-fast', 'v2', 4119, 34868],
  ['GLM 4.7 Flash', '@cf/zai-org/glm-4.7-flash', 'v2', 5500, 36400, NO_THINK],
  ['Gemma 4 26B', '@cf/google/gemma-4-26b-a4b-it', 'v2', 9091, 27273, NO_THINK],
  ['70B fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'v2', 26668, 204805],
];

async function ask(model, prompt, first, second, extra) {
  const q = new URLSearchParams({ model, prompt, first, second, extra: JSON.stringify(extra ?? {}) });
  const res = await fetch(`${BASE}/run?${q}`);
  return res.json();
}

const rows = [];
const cost = Object.fromEntries(VARIANTS.map(([label]) => [label, { neurons: 0, n: 0, ms: 0, refused: 0, errors: 0 }]));
for (const [first, second, expect] of PAIRS) {
  const row = { pair: `${first} + ${second}`, expect, cells: [] };
  const answers = await Promise.all(VARIANTS.map(([, model, prompt, , , extra]) => ask(model, prompt, first, second, extra)));
  answers.forEach((a, i) => {
    const [label, , , pin, pout] = VARIANTS[i];
    const c = cost[label];
    if (a.error) {
      c.errors++;
      row.cells.push(`ERR`);
      return;
    }
    if (a.result === 'REFUSED') c.refused++;
    c.n++;
    c.ms += a.ms;
    if (a.usage) c.neurons += a.usage.neurons ?? ((a.usage.prompt_tokens ?? 0) * pin + (a.usage.completion_tokens ?? 0) * pout) / 1e6;
    row.cells.push(a.result === 'REFUSED' ? 'REFUSED' : a.result ? `${a.result.name} ${a.result.emoji}` : '(nothing)');
  });
  rows.push(row);
  process.stdout.write('.');
}
console.log();

const header = `| Pair | Expected | ${VARIANTS.map((v) => v[0]).join(' | ')} |`;
const sep = `|${' --- |'.repeat(VARIANTS.length + 2)}`;
const body = rows.map((r) => `| ${r.pair} | ${r.expect} | ${r.cells.join(' | ')} |`);
const foot = [
  '',
  '| Model | Neurons per new pair | New pairs/day on 10k free | Avg ms | Refused | Errors |',
  '| --- | --- | --- | --- | --- | --- |',
  ...VARIANTS.map(([label]) => {
    const c = cost[label];
    const per = c.n ? c.neurons / c.n : 0;
    return `| ${label} | ${per ? per.toFixed(2) : '?'} | ${per ? Math.floor(10000 / per).toLocaleString() : '?'} | ${c.n ? Math.round(c.ms / c.n) : '?'} | ${c.refused} | ${c.errors} |`;
  }),
];
const md = [header, sep, ...body, ...foot].join('\n');
console.log(md);
writeFileSync(new URL('./results.md', import.meta.url), md + '\n');
