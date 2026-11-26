# combobulate-api

The backend for [Combobulate](https://leonhogan.com/combobulate/): one Cloudflare Worker that asks an AI what two things make, and remembers every answer in a D1 database.

**Optional, recommended:** your own free AI server on Oracle Cloud removes the daily limit. The Worker asks it first and only uses Workers AI as a backup. See [server/README.md](server/README.md).

Everything runs on Cloudflare's **free plan**. You don't need a credit card, and nothing can bill you: once the daily AI allowance (10,000 neurons, roughly 8,000 brand-new pairs) is used up, new pairs just pause until 00:00 UTC. Pairs someone already found keep working, because they come from the database.

## How it works

```
GET /pair?first=Water&second=Fire
  1. Sort the pair (Fire+Water = Water+Fire) and look it up in D1   → found: return it
  2. Both inputs must be real elements (no made-up words)           → else 400
  3. Per-visitor daily cap on brand-new pairs (DAILY_NEW_PER_VISITOR) → else 429
  4. Ask Llama 3.2 3B: your Oracle server if LLM_URL is set, else/fallback Workers AI;
     save the recipe and new element
  ← { "result": { "name": "Steam", "emoji": "♨️" } | null, "isNew": true }
```

`isNew: true` means nobody had ever made that element before (a ★ first discovery).

## Deploy (one time)

1. Make a free account at <https://dash.cloudflare.com/sign-up>.
2. Log in from this folder (opens your browser):

   ```powershell
   cd combobulate-api
   npx wrangler login
   ```

3. Create the database, then copy the `database_id` it prints into `wrangler.toml` (replace `REPLACE_WITH_YOUR_D1_DATABASE_ID`):

   ```powershell
   npx wrangler d1 create combobulate
   ```

4. Create the tables and the four starting elements:

   ```powershell
   npm run db:init
   ```

5. Deploy. It prints your Worker's URL, like `https://combobulate-api.<your-subdomain>.workers.dev`:

   ```powershell
   npm run deploy
   ```

6. Put that URL in `COMBOBULATE_API` in `../src/site.ts`, then commit and push. GitHub Pages rebuilds the site and the game goes live.

Optional: set a private salt for the hashed visitor IDs used by the daily cap:

```powershell
npx wrangler secret put VISITOR_SALT
```

## Local development

| Command | What it does |
| --- | --- |
| `npm run dev:mock` | Runs the Worker on http://localhost:8787 with **fake** results and a local database. No login needed. |
| `npm run dev` | Real AI (uses your daily allowance) with a local database. Needs `wrangler login` and `npm run db:init:local` first. |
| `npm test` | Unit tests for the reply parser and helpers. |

With either one running, `npm run dev` in the site folder serves the game at http://localhost:4321/combobulate/, talking to the local Worker.

## Settings (`wrangler.toml` → `[vars]`)

- `MODEL`: any Workers AI text model. `@cf/meta/llama-3.1-8b-instruct` gives better answers but uses about 4× the allowance per new pair (about 2,000 a day).
- `DAILY_NEW_PER_VISITOR`: brand-new pairs one visitor can generate per day.
- `ALLOWED_ORIGINS`: sites allowed to call the API from a browser.

The prompt lives in `src/craft.js` (`buildPrompt`). Changing it only affects pairs nobody has tried yet, because existing answers are saved permanently.
