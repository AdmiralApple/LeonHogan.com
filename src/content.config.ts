import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

// Games you've made. One Markdown file per game in src/content/games/.
const games = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/games' }),
  schema: z.object({
    title: z.string(),
    tagline: z.string(), // one sentence, shown on cards
    year: z.number().int(), // year it came out (or started, if unreleased)
    kind: z.enum(['game', 'jam', 'toy', 'tool']).default('game'),
    status: z.enum(['released', 'in-development', 'on-hold']).default('released'),
    engine: z.string().optional(), // e.g. "Unity", "JavaScript"
    platforms: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    cover: z.string().optional(), // image URL, or a path in /public like "/images/my-game.png"
    featured: z.boolean().default(false),
    jam: z.string().optional(), // jam name, if it was made for one
    credits: z.string().optional(),
    links: z
      .object({
        play: z.string().url().optional(), // play in browser
        site: z.string().url().optional(), // the game's own website
        itch: z.string().url().optional(),
        steam: z.string().url().optional(),
        source: z.string().url().optional(),
        trailer: z.string().url().optional(),
      })
      .default({}),
  }),
});

// Game reviews come straight from the Leon's Game Reviews app export.
// Run `npm run sync-reviews` to pull the latest library.json + covers.
const reviews = defineCollection({
  loader: file('src/data/library.json', { parser: (text) => JSON.parse(text).games }),
  schema: z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['Completed', 'Playing', 'Dropped', 'On Hold', 'Plan to']),
    rating: z.number().min(0).max(10).nullable(),
    date: z.string().nullable(),
    feelings: z.string().nullable(),
  }),
});

const covers = defineCollection({
  loader: file('src/data/steam-covers.json', { parser: (text) => JSON.parse(text).covers }),
  schema: z.object({
    url: z.string(),
    name: z.string().optional(),
    appid: z.number().optional(),
  }),
});

// Blog posts. One Markdown file per post in src/content/blog/.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { games, reviews, covers, blog };
