// GET /run?model=@cf/...&prompt=v1|v2&first=Fire&second=Mud
// Asks one Workers AI model one pair, with no database involved. Uses your real free allowance.
import { buildPrompt, buildPromptV1, isRefusal, parseReply } from '../src/craft.js';
import { workersAIText } from '../src/providers.js';

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    const model = u.searchParams.get('model');
    const first = u.searchParams.get('first');
    const second = u.searchParams.get('second');
    const messages = (u.searchParams.get('prompt') === 'v1' ? buildPromptV1 : buildPrompt)(first, second);
    if (/qwen3/.test(model)) messages.at(-1).content += ' /no_think';
    const started = Date.now();
    try {
      const extra = JSON.parse(u.searchParams.get('extra') || '{}');
      const out = await env.AI.run(model, { messages, max_tokens: 48, temperature: 0.5, ...extra });
      if (u.searchParams.get('raw')) return Response.json(out);
      const text = workersAIText(out);
      return Response.json({
        text,
        result: isRefusal(text) ? 'REFUSED' : parseReply(text),
        ms: Date.now() - started,
        usage: out.usage ?? null,
      });
    } catch (err) {
      return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
    }
  },
};
