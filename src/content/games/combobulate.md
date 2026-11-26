---
title: "Combobulate"
tagline: "Smash two things together and see what an AI thinks they make. Every discovery is shared."
year: 2026
kind: "toy"
status: "released"
engine: "JavaScript + Cloudflare Workers AI"
platforms: ["Browser"]
tags: ["AI", "Crafting", "Sandbox"]
links:
  play: "https://leonhogan.com/combobulate/"
---

Start with Water, Fire, Earth and Air. Drag one thing onto another and a small AI model decides what they make. Then keep going and see how far you can get from four elements.

Each pair is only ever asked once. The answer gets saved and everyone shares it, so Fire + Water makes the same thing for everybody. If you're the first person ever to make something, it gets a ★.

It runs entirely on Cloudflare's free tier: a Worker, a D1 database, and Workers AI running Llama 3.2 3B.
