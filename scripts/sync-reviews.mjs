// Mirrors the Leons-Game-Reviews site into public/reviews/, so
// leonhogan.com/reviews/ is an exact copy of the original app.
// The home page's "Recently played" section reads the same library.json.
// Run with: npm run sync-reviews
import { writeFile } from 'node:fs/promises';

const BASE = 'https://raw.githubusercontent.com/AdmiralApple/Leons-Game-Reviews/master/';
const FILES = ['index.html', 'library.json', 'steam-covers.json'];

for (const name of FILES) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  if (name.endsWith('.json')) JSON.parse(text); // fail loudly on a bad file instead of breaking the build
  await writeFile(new URL(`../public/reviews/${name}`, import.meta.url), text);
  console.log(`Updated public/reviews/${name}`);
}
