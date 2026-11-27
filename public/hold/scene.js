// One seed, one hold: a dwarf hold dug into a mountain, seen as a cut through the rock, drawn with procedural-almanac
// and nothing else. hold(seed) grows the world from its seed and gives back frame(f), each frame a buffer of packed
// pixels, the same in a browser (index.html) and in Node (hold.mjs). A seed becomes noise; the noise becomes rock in
// layers with veins of ore; caverns open low down, a lake fills them and magma glows under them; a band of dwarves
// arrives over the grass and digs the hold outward from the gate; the rooms are furnished; the torches are lit. From
// then on the dwarves live there for ever: they work by day and sleep by night, one day after another. Each stage's
// caption names the techniques it shows.
//
// The parts, in the order they are made:
//   look.js    the palette (indexed, with every colour's shades), and the small pictures drawn from it
//   world.js   the surface, the rock, the caverns, the plan of the hold, what is in its rooms, its lights
//   life.js    what moves, a step at a time: dwarves, bats, drips, embers, sleepers' z's, fireflies
//   draw.js    one frame: the rock and the rooms in palette numbers, then the light, the sky, what glows, captions
//
// Every part is a function that takes the settings below (k) and the parts made before it, and returns what the later
// parts need.
import * as almanac from './almanac/index.js';
import { makeLook, makeSprites } from './look.js';
import { buildWorld } from './world.js';
import { makeLife } from './life.js';
import { makeDrawing } from './draw.js';

/**
 * Grows the hold for a seed and returns a player for its film.
 *
 * How it works: the seed phrase becomes a number (seedOf), and every random choice is drawn from that number, so the
 * same phrase always gives the same hold. The parts are made once, in order; after that, frame(f) moves the hold's
 * life on to frame f and paints that frame.
 *
 * @param {string|number} [phrase] the seed, as words or a number (granite-deep-4)
 * @returns {{W: number, H: number, FPS: number, DUR: number, frames: number, opening: number, T: object,
 *   phrase: string, seed: number, used: Set<string>, frame: function(number): Uint32Array, report: function():
 *   string[], A: object}}
 */
export function hold(phrase = 'granite-deep-4', opts = {}) {
  // opts, all optional: W and H, the picture's size in its own pixels (any size: the hold grows to fill it); captions
  // and mark (false to leave out the captions and the library's name); maxDwarves; intro (false: the hold starts
  // already built and lived in); clock (days to wind the clock on, so a background can carry its hour from page to
  // page); darkness (0: the cut-away drawn in full light, 1: dark underground but for the torches).
  // Every technique the film calls is counted on its way through: A is a copy of the almanac in which each function
  // first writes its own name into `used`, then does its work. Classes are counted when one is made.
  const used = new Set();
  const A = {};
  for (const [name, f] of Object.entries(almanac))
    A[name] =
      typeof f !== 'function'
        ? f
        : /^[A-Z]/.test(name)
          ? class extends f {
              constructor(...a) {
                super(...a);
                used.add(name);
              }
            }
          : (...a) => {
              used.add(name);
              return f(...a);
            };
  const { clamp, lerp, seedOf } = A;

  const W = Math.max(320, Math.round((opts.W || 576) / 4) * 4), // the picture, in its own pixels (whole tiles)
    H = Math.max(200, Math.round((opts.H || 324) / 4) * 4),
    TS = 4, // a tile is 4 by 4 pixels: the hold is dug a tile at a time
    GW = W / TS,
    GH = H / TS,
    FPS = 20;
  const PHRASE = String(phrase).trim() || 'granite-deep-4',
    SEED = seedOf(PHRASE);

  // ---------------------------------------------------------------------------------------------------- the timeline
  const STAGES = [
    ['seed', 1.2], // the seed's noise, one octave at a time
    ['strata', 1.4], // the rock appears, top to bottom
    ['caves', 1.4], // caverns open, a lake fills them, magma glows
    ['embark', 1.6], // trees grow, the gate rises, the dwarves arrive
    ['dig', 3.0], // the hold is dug, outward from the gate
    ['furnish', 1.6], // the rooms are furnished as the dwarves move in
    ['lights', 1.4], // dark falls underground and the torches are lit
    ['life', 6.0], // the dwarves at work: this stage only holds its caption, as life goes on for ever after it
  ];
  // T[stage] = [start, end] in seconds, the stages laid end to end. Laid out again once the hold is planned, since a
  // bigger hold takes longer to dig (see below).
  const T = {};
  let DUR = 0,
    LIFE0 = 0;
  const lay = () => {
    DUR = 0;
    for (const [key, d] of STAGES) T[key] = [DUR, (DUR += d)];
    LIFE0 = T.life[0];
  };
  lay();
  const span = (key, t) => clamp((t - T[key][0]) / (T[key][1] - T[key][0]));
  // Each stage's caption. Words in backticks are the almanac's function names, drawn in gold; report() checks that
  // every one of them was really called.
  const CAPTIONS = {
    seed: [`\`seedOf\`('${PHRASE}') = ${SEED}`, '`fractalNoise`, one octave at a time'],
    strata: ['`noiseLine` · `ridgedNoise` · `ditheredBorder`', '`hueShiftTone` · `latticeRandom`'],
    caves: ['`floodFill` · `untilSettled` · `capsuleSteps`', '`chamferDistance` · `waterPixel`'],
    embark: ['`genomeFrom` · `layTemplate` · `outlineSprite`', '`formationSlot` · `footStep` · `leafCrown`'],
    dig: ['`untilSettled`: ring by ring from the gate', '`wallShade` · `lineCells`'],
    furnish: ['`spriteFromRows` · `dampedSpring` · `blitSway`', '`gridAStar` · `strideRate`'],
    lights: ['`segmentClear` · `scalePacked` · `mixPacked`', '`scatterAlong`'],
    life: ['`crossGenomes` · `gridAStar` · `nearestFreeCell`', '`flockStep` · `rise` · `fall` · `blink`'],
    night: ['`hourLight` · `twinkle` · `pulseRise`', '`hover` · `wrapAround` · `ditherEllipse`'],
    dawn: ['`shadeEllipse` · `stampCache` · `bayerThreshold`'],
  };
  // The time of day (as hourLight counts it: 0.25 noon, 0.5 dusk, 0.75 midnight). A morning while the hold is made;
  // from the start of life, a day of DAYLEN seconds after another, for ever.
  const DAYLEN = 90,
    CLOCK = opts.clock || 0,
    clockAt = (t) => (t < LIFE0 ? lerp(0.04, 0.12, t / LIFE0) : 0.12 + CLOCK + (t - LIFE0) / DAYLEN); // days, counting on
  const timeOfDay = (t) => clockAt(t) % 1;
  // the dwarves are abed from a little after dusk until just before dawn
  const BED = [0.55, 0.96];
  const bedtime = (t) => {
    const tod = timeOfDay(t);
    return t >= LIFE0 && tod >= BED[0] && tod < BED[1];
  };
  // which day it is (the first is day 1) and what part of it, for the page
  const dayOf = (t) => {
    const c = clockAt(t),
      tod = c % 1;
    return { day: Math.floor(c) + 1, part: tod < 0.15 ? 'morning' : tod < 0.38 ? 'midday' : tod < 0.5 ? 'afternoon' : tod < 0.58 ? 'dusk' : tod < 0.94 ? 'night' : 'dawn' };
  };
  // Which caption shows at t: a stage's while it lasts, then the night's for a few seconds after each bedtime and the
  // dawn's at each waking; the end card with the count of techniques shows at the first dawn.
  const CAPS = opts.captions !== false;
  const captionAt = (t) => {
    if (!CAPS) return null;
    for (const [key] of STAGES) if (t >= T[key][0] && t < T[key][1]) return key;
    const tod = timeOfDay(t);
    if (tod >= BED[0] && tod < BED[0] + 5 / DAYLEN) return 'night';
    if (tod >= BED[1] && tod < BED[1] + 4 / DAYLEN) return 'dawn';
    return null;
  };
  const endCard = (t) => CAPS && t > LIFE0 && clockAt(t) < 1 + BED[1] + 6 / DAYLEN && timeOfDay(t) >= BED[1];

  // ---------------------------------------------------------------------------------------------------- the parts
  // prettier-ignore
  const k = { A, used, W, H, TS, GW, GH, FPS, PHRASE, SEED, STAGES, T, DUR, span, CAPTIONS, timeOfDay, bedtime,
    captionAt, endCard, mark: opts.mark !== false, intro: opts.intro !== false, maxDwarves: opts.maxDwarves || 30,
    darkness: opts.darkness === undefined ? 1 : opts.darkness };
  const look = makeLook(k),
    world = buildWorld(k, look);
  // The dig takes as long as the hold is deep: about 36 rings of tiles a second out from the gate (3 seconds or more,
  // 16 at most), and furnishing a big hold takes a little longer too. Everything after moves along to make room.
  const stage = (key) => STAGES.find((s) => s[0] === key);
  stage('dig')[1] = opts.dig || clamp(world.MAXD / 36, 3, 16);
  stage('furnish')[1] = clamp(world.MAXD / 100, 1.6, 4);
  lay();
  k.DUR = DUR;
  const pics = makeSprites(k, look),
    life = makeLife(k, look, world),
    draw = makeDrawing(k, look, world, pics, life);

  const sim = life.sim;
  /** Moves the hold's life on, a twentieth of a second at a time, until it has reached frame f. */
  function advance(f) {
    while (sim.f < f) {
      sim.f++;
      life.step(sim.f / FPS, 1 / FPS);
    }
  }
  /**
   * The picture at frame f (only rows y0 to y1 of it painted, if given). Going back in time wipes life and runs it
   * again from the first frame.
   */
  function frame(f, y0, y1) {
    if (f < sim.f) {
      for (const key of Object.keys(sim)) delete sim[key];
      sim.f = -1;
    }
    advance(f);
    return draw.frame(f / FPS, y0, y1);
  }
  /**
   * A short account of the hold, as lines of text: its levels and rooms, its dwarves and their jobs, the techniques
   * called so far, and any technique a caption names that was never called (which would make that caption untrue).
   */
  function report() {
    const named = new Set(
      Object.values(CAPTIONS)
        .flat()
        .join(' ')
        .match(/`([A-Za-z]+)`/g)
        .map((s) => s.slice(1, -1)),
    );
    const missing = [...named].filter((name) => !used.has(name)),
      rooms = {};
    for (const r of world.ROOMS) rooms[r.type] = (rooms[r.type] || 0) + 1;
    const lines = [
      `${world.FLOORS.length} levels, ${world.ROOMS.length} rooms (${Object.entries(rooms)
        .map(([t, c]) => `${c} ${t}`)
        .join(', ')}), ${world.MINES.length} mines, ${world.WELL ? 'a well' : 'no well'}, ${world.LIGHTS.length} lights, ${world.ITEMS.length} things`,
      `${life.DWARVES.length} dwarves: ${life.DWARVES.map((d) => d.job + (d.g.child ? ' (child)' : '')).join(', ')}`,
      `${used.size} techniques of ${Object.keys(almanac).length} used: ${[...used].sort().join(', ')}`,
    ];
    if (missing.length) lines.push(`named in a caption but never used: ${missing.join(', ')}`);
    return lines;
  }
  return {
    W,
    H,
    FPS,
    DUR,
    T,
    frames: Math.round(DUR * FPS), // the build-up; life goes on past it for ever
    opening: T.life[0] + 0.5, // where the page starts: the hold built, lit and busy
    dayOf,
    clockAt,
    DAYLEN,
    setDarkness: (v) => (k.darkness = v), // how dark it is underground, 0..1, changeable at any time
    phrase: PHRASE,
    seed: SEED,
    used,
    frame,
    report,
    A,
    world,
    life,
  };
}
