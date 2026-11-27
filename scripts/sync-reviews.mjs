// Mirrors the Leons-Game-Reviews site into public/reviews/, so
// leonhogan.com/reviews/ is an exact copy of the original app (plus a link back home).
// The home page's "Recently played" section reads the same library.json.
// Run with: npm run sync-reviews
import { writeFile } from 'node:fs/promises';

const BASE = 'https://raw.githubusercontent.com/AdmiralApple/Leons-Game-Reviews/master/';
const FILES = ['index.html', 'library.json', 'steam-covers.json'];

// The app is a self-unpacking bundle: its real page is a JSON string inside index.html, which replaces the document as
// it loads. A "back to leonhogan.com" link is added inside that page, above the app, so it survives the unpacking.
const inJson = (html) => JSON.stringify(html).slice(1, -1); // as it is written inside the bundle's JSON string
const BODY = inJson('<body>\n\n<div id="root"></div>');
const HOME = inJson(`<body>

<style>
  .lh-home { position: relative; z-index: 2; max-width: 1400px; margin: 0 auto; padding: 18px 24px 0; }
  .lh-home a { font: 500 11px/1 "JetBrains Mono", monospace; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); text-decoration: none; padding: 6px 10px 6px 8px; margin-left: -8px; border-radius: 6px; }
  .lh-home a:hover, .lh-home a:focus-visible { color: var(--onhold-2); background: rgba(255,235,200,.05); outline: none; }
  .lh-home + #root > div { padding-top: 14px !important; }
</style>
<nav class="lh-home" aria-label="Site"><a href="/">← leonhogan.com</a></nav>
<div id="root"></div>`);

function addHomeLink(html) {
  if (html.includes('lh-home')) return html;
  if (!html.includes(BODY)) {
    console.warn('Reviews app: could not find where to add the home link; left as it is');
    return html;
  }
  return html.replace(BODY, () => HOME);
}

for (const name of FILES) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  let text = await res.text();
  if (name.endsWith('.json')) JSON.parse(text); // fail loudly on a bad file instead of breaking the build
  if (name === 'index.html') text = addHomeLink(text);
  await writeFile(new URL(`../public/reviews/${name}`, import.meta.url), text);
  console.log(`Updated public/reviews/${name}`);
}
