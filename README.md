# leonhogan.com

My personal site: games I've made, my game log/reviews, and a blog. Built with [Astro](https://astro.build), so every page is plain static HTML.

## Run it locally

```powershell
npm install
npm run dev
```

Then open http://localhost:4321. Pages reload as you edit.

## Adding things

### A game

Add a Markdown file to `src/content/games/`. The file name becomes the URL (`my-game.md` → `/games/my-game/`).

```md
---
title: "My Game"
tagline: "One sentence for the card."
year: 2026
kind: "game"            # game | jam | toy | tool
status: "released"      # released | in-development | on-hold
engine: "Unity"
platforms: ["Browser", "Windows"]
tags: ["Puzzle"]
cover: "/images/games/my-game.png"   # put the image in public/images/games/ (or use a full URL)
featured: true          # show it on the home page
jam: "Some Game Jam"    # optional
links:
  play: "https://..."   # play in browser
  itch: "https://elwood-hogan.itch.io/..."
  steam: "https://..."
  site: "https://..."
  source: "https://github.com/..."
---

Write about the game here: what it is, how to play, a dev story.
```

### A review

Keep logging games in the **Leon's Game Reviews** app the way you always have. This site reads its `library.json` and Steam covers:

- Every deploy (and a daily scheduled rebuild) pulls the latest copy automatically.
- To pull it locally: `npm run sync-reviews`

### A blog post

Add a Markdown file to `src/content/blog/`:

```md
---
title: "Post title"
description: "One-line summary for lists and link previews."
date: 2026-11-25
tags: ["devlog"]
draft: false            # true = only shows while running `npm run dev`
---

Your post, in Markdown.
```

## Where things live

| What | Where |
| --- | --- |
| Name, tagline, social links | `src/site.ts` |
| Colours and fonts | `src/styles/global.css` (top of the file) |
| Home page | `src/pages/index.astro` |
| About page | `src/pages/about.astro` |
| Content schemas | `src/content.config.ts` |

## Deploying (GitHub Pages)

`.github/workflows/deploy.yml` builds and publishes the site on every push to `main`.

1. Create a GitHub repo and push this folder to it.
2. In the repo, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. In the same Pages settings, set the custom domain to `leonhogan.com` and tick **Enforce HTTPS** once it's available.
4. At your domain registrar, point the domain at GitHub Pages:
   - `A` records for `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME` record for `www` → `<your-github-username>.github.io`

DNS can take up to a day to propagate.
