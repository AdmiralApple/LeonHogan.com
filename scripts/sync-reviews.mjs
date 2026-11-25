// Pulls the latest review library + Steam cover manifest from the
// Leons-Game-Reviews repo into src/data/. Run with: npm run sync-reviews
import { writeFile } from 'node:fs/promises';

const BASE = 'https://raw.githubusercontent.com/AdmiralApple/Leons-Game-Reviews/master/';
const FILES = ['library.json', 'steam-covers.json'];

for (const name of FILES) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  JSON.parse(text); // fail loudly on a bad file instead of breaking the build later
  await writeFile(new URL(`../src/data/${name}`, import.meta.url), text);
  console.log(`Updated src/data/${name}`);
}
