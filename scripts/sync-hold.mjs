// Copies the dwarf-hold background (and the procedural-almanac library it is drawn with) into public/hold/, where the
// site serves it as plain static files. Run it after changing the hold in the almanac's examples/hold folder:
//
//   npm run sync-hold
//
// The almanac lives outside this repo; set HOLD_SRC to point somewhere else if it moves. The copied files are committed,
// so the deploy build does not need the almanac at all.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const almanac = process.env.HOLD_SRC || 'D:/Coding Related/Procedural Generation/procedural-almanac';
const out = join(site, 'public', 'hold');
if (!existsSync(join(almanac, 'examples', 'hold', 'scene.js'))) {
  console.error(`No hold found at ${almanac}/examples/hold. Set HOLD_SRC to the procedural-almanac folder.`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// the library, as it is
cpSync(join(almanac, 'src'), join(out, 'almanac'), { recursive: true });
cpSync(join(almanac, 'LICENSE'), join(out, 'LICENSE'));
// the hold's own files, with their imports pointed at the copies beside them
const rewrite = {
  "'../../src/index.js'": "'./almanac/index.js'",
  "'../island/font.js'": "'./font.js'",
};
for (const name of ['scene.js', 'look.js', 'world.js', 'life.js', 'draw.js', 'background.js', 'hold-worker.js']) {
  let text = readFileSync(join(almanac, 'examples', 'hold', name), 'utf8');
  for (const [from, to] of Object.entries(rewrite)) text = text.split(from).join(to);
  writeFileSync(join(out, name), text);
}
cpSync(join(almanac, 'examples', 'island', 'font.js'), join(out, 'font.js'));
writeFileSync(
  join(out, 'README.md'),
  `# The hold\n\nThe living background: a dwarf hold drawn with [procedural-almanac](https://github.com/BlaiseLabs/procedural-almanac) (MIT, see LICENSE).\nCopied here by \`npm run sync-hold\`; edit the originals in the almanac's \`examples/hold\`, not these.\n`,
);
console.log(`Copied the hold into ${out}`);
