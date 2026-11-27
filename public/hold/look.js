// The look of the hold: its palette, kept as indexed colour with every colour's lit and unlit shades worked out once,
// and the small pictures drawn from it: furniture, the gate, trees, torches, bats and the dwarves themselves.
//
// Indexed colour: a frame is first painted as palette numbers (1, 2, 3 ...; 0 is the sky), then each number is turned
// into a colour by how much light falls on its pixel. So every colour is given its 16 shades once, when it first
// joins the palette, and lighting a frame is one table lookup a pixel.

/**
 * The palette and the colour helpers.
 *
 * How it works: hex() grades a "#rrggbb" colour once, the way the whole film is graded, and packs it into a number.
 * idx() gives a packed colour its palette number, adding it (and its 16 shades) the first time. A shade below full
 * light is darker and turns toward a night blue; above full light (near a torch) it is brighter and warmer. A colour
 * added as glowing keeps the same colour in every shade: fire, magma, fungus, gems.
 */
export function makeLook(k) {
  const { A } = k;
  const { gradeColour, hexToRgb, hueShiftTone, mixPacked, packRgb, scalePacked } = A;
  const GRADE = { sat: 1.05, warm: 0.03, contrast: 1.05 };
  const HEX = new Map();
  const hex = (s) => {
    let c = HEX.get(s);
    if (c === undefined) HEX.set(s, (c = packRgb(...hexToRgb(gradeColour(s, GRADE)))));
    return c;
  };
  // tone(c, k): colour c made k steps darker (k < 0) or lighter (k > 0), k from -2 to 2, turning its hue as a pixel
  // artist would (hueShiftTone): darker toward blue, lighter toward yellow
  const RAMPS = new Map();
  const tone = (c, k) => {
    let r = RAMPS.get(c);
    if (!r) RAMPS.set(c, (r = [-1.7, -0.85, 0, 0.75, 1.5].map((s) => (s ? hueShiftTone(c, s) : c))));
    return r[Math.max(-2, Math.min(2, k)) + 2];
  };
  const LV = 16, // shades a colour: shade L is L/10 of full light, so 10 is full and 15 one and a half
    NIGHT = hex('#0a0a1e'),
    WARM = hex('#ffbe62');
  const shade = (c, b) =>
    b === 1
      ? c
      : b < 1
        ? mixPacked(scalePacked(c, 0.06 + 0.94 * b), NIGHT, (1 - b) * 0.22)
        : mixPacked(scalePacked(c, 1 + (b - 1) * 0.3), WARM, (b - 1) * 0.45);
  const PAL = [],
    SH = [],
    KEY = new Map();
  function idx(c, glow = false) {
    const key = glow ? -1 - c : c;
    let i = KEY.get(key);
    if (i === undefined) {
      i = PAL.length;
      PAL.push(c);
      KEY.set(key, i);
      for (let L = 0; L < LV; L++) SH.push(glow ? c : shade(c, L / 10));
    }
    return i + 1;
  }
  const I = (s, glow) => idx(hex(s), glow), // a "#rrggbb" as its palette number
    IT = (s, k) => idx(tone(hex(s), k)); // the same, k tones lighter or darker

  // the named colours, as "#rrggbb"
  const C = {
    ink: '#1a1218',
    soil: '#7a5236',
    grass: '#4f9a3e',
    grassLit: '#79c45a',
    stone: ['#a8977a', '#8a8592', '#4f4a5c'], // the upper, middle and deep stone
    ore: [null, '#26222a', '#d0773a', '#a4553a', '#d8dde6', '#f4c64e'],
    gems: ['#4fe0d0', '#f05a90', '#8a72ff', '#6ef08a'],
    magma: ['#4a0c0a', '#951a10', '#d83a16', '#ff7a24', '#ffc24e', '#fff0b0'],
    fungus: ['#5cf0cc', '#b88cff', '#2fb8a0'],
    wood: '#8a5a32',
    woodD: '#5a361e',
    woodL: '#b47d47',
    stoneF: '#9a958c', // dressed stone, for furniture
    stoneD: '#6a6660',
    stoneL: '#c4bfb4',
    marble: '#ddd6ca',
    marbleD: '#a8a094',
    metal: '#7d8794',
    metalL: '#c8d0da',
    gold: '#f2c14e',
    goldD: '#b8862a',
    goldL: '#fff2a8',
    copper: '#c87533',
    copperL: '#eaa060',
    white: '#efe6d2',
    rope: '#c8b080',
    cloth: ['#b8423a', '#3a6fb8', '#4f9a4a', '#c08a2a', '#7a4aa0', '#2a8a8a'],
    books: ['#a83a32', '#3a7a3a', '#3a5aa8', '#c8a040'],
    fire: ['#fff3b0', '#ffb347', '#f0632e'],
    bat: '#2e2238',
    text: '#f6eed8',
    accent: '#ffd36e',
    textInk: '#1a1824',
    mark: '#c8c0b0',
    star: '#e6eeff',
    firefly: '#e9ff8f',
    ember: '#ffb04a',
    drip: '#9ad4f0',
    zzz: '#dfe8ff',
    spark: '#fff6c0',
    dust: '#e8dcc0',
  };
  // the cavern water's palette for waterPixel, as palette numbers so it is lit like everything else
  const WP = {
    LV: ['#4aa0c8', '#3c8cb8', '#3078a6', '#266694', '#1e5480', '#18446c', '#12365a'].map((s) => I(s)),
    FOAM: I('#b8eaf8'),
    FOAM2: I('#7ac8e4'),
    GLINT: I('#f0fcff'),
    GLINT2: I('#c4ecf8'),
    WEED: I('#1c4a5c'),
    WEED2: I('#26586a'),
    SAND: ['#3a7a90', '#3a7a90', '#3a7a90'].map((s) => I(s)),
  };
  // nine greys, dark to light, for the seed's noise (packed colours, drawn straight to the frame)
  const GREYS = ['#16182a', '#2a2b3c', '#40404e', '#575562', '#706c76', '#8b8690', '#a7a1a8', '#c7c1c1', '#ebe5d6'].map(hex);
  // and nine dim ones, for a page with a dark background: deep violet-greys that rise only a little from near black,
  // so the noise glows softly instead of flashing white
  const GREYS_DIM = ['#0f0d13', '#141119', '#19161f', '#1f1b26', '#26212e', '#2d2737', '#352e40', '#3e364a', '#483f55'].map(hex);
  return { hex, tone, idx, I, IT, PAL, SH, LV, C, WP, GREYS, GREYS_DIM };
}

/**
 * The small pictures, all drawn in palette numbers: furniture, the gate, trees, torches, bats and dwarves.
 *
 * How it works: most are written as rows of letters and read through a little palette (spriteFromRows), with a dark
 * line round them. Fires are drawn as three frames whose flames trade places. A dwarf is put together on a grid of
 * letters from templates laid one over another (layTemplate): the body, then a beard, then a hat; its legs are placed
 * for the moment of its step (footStep), and the grid becomes pixels (gridPixels) with a line round it (outlineSprite).
 */
export function makeSprites(k, look) {
  const { A, SEED } = k;
  // prettier-ignore
  const { SeededRandom, barkTrunk, cutSprite, drawnBounds, fillEllipse, footStep, gridPixels, layTemplate, leafCrown,
    lineCells, outlinePass, outlineSprite, spriteFromRows, stampCache } = A;
  const { hex, tone, idx, I, C } = look;
  const INK = I(C.ink);
  const cache = stampCache(4000);
  const buffer = (w, h) => ({ w, h, px: new Uint32Array(w * h) });
  const trim = (r, ax, ay) => {
    const b = drawnBounds(r);
    return b ? cutSprite(r, b[0], b[1], b[2], b[3], ax, ay) : null;
  };
  // a sprite from rows of letters and a map of letter to "#rrggbb" (or to a palette number already)
  const rows = (lines, map, o = {}) =>
    spriteFromRows(lines, (ch) => (typeof map[ch] === 'number' ? map[ch] : map[ch] ? I(map[ch]) : 0), { ink: INK, ...o });
  // a fire's three frames: each digit 1..3 is one of the flame's colours, and each frame moves every digit on by one
  const FIRE = C.fire.map((s) => I(s, true));
  const flames = (lines, map) =>
    [0, 1, 2].map((f) =>
      rows(lines, { ...map, 1: FIRE[(0 + f) % 3], 2: FIRE[(1 + f) % 3], 3: FIRE[(2 + f) % 3] }),
    );
  const S = {
    bed: C.cloth.map((cl) => rows(['h.......', 'hppbbbbb', 'hwwwwwwh', 'w......w'], { h: C.woodD, p: C.white, b: cl, w: C.wood })),
    table: [
      rows(['tttttttt', '.l....l.', '.l....l.', '.l....l.'], { t: C.woodL, l: C.woodD }),
      rows(['..m..f..', 'tttttttt', '.l....l.', '.l....l.', '.l....l.'], { t: C.woodL, l: C.woodD, m: C.metalL, f: '#d8a050' }),
    ],
    chair: [rows(['b..', 'b..', 'sss', 'l.l'], { b: C.woodD, s: C.wood, l: C.woodD })],
    barrel: [rows(['.ww.', 'hhhh', 'wwww', 'hhhh', '.ww.'], { w: C.wood, h: C.metal })],
    crate: [rows(['CCCCC', 'CdcdC', 'CcdcC', 'CdcdC', 'CCCCC'], { C: C.woodD, c: C.wood, d: C.woodD })],
    anvil: [rows(['AAAAAa', '.aaaa.', '..aa..', '.ssss.'], { A: C.metalL, a: C.metal, s: C.stoneD })],
    furnace: flames(
      ['.....cc.', '.....cc.', '.ssssss.', 'ssssssss', 'sS1221Ss', 'sS2332Ss', 'sS1221Ss', 'ssssssss', 'ssssssss'],
      { c: C.stoneD, s: C.stoneD, S: C.stoneF },
    ),
    oven: flames(['.ssss.', 'ssssss', 's1221s', 's2332s', 'ssssss', 'ssssss'], { s: C.stoneF }),
    still: [rows(['..p..', '..p..', '.ccc.', 'ccccc', 'cCccc', '.ccc.', '.s.s.'], { p: C.metal, c: C.copper, C: C.copperL, s: C.woodD })],
    bench: [rows(['..h..s...', 'ttttttttt', '.l.....l.', '.l.vvv.l.', '.l.....l.'], { h: C.metal, s: C.metalL, t: C.woodL, l: C.woodD, v: C.metal })],
    blocks: [rows(['.bb...', 'bbbbb.', 'bBbBbb', 'bbbbbb'], { b: C.stoneL, B: C.stoneF })],
    statue: [rows(['.mm.', 'mmmm', '.mm.', 'mMMm', '.mm.', '.mm.', 'pppp', 'pppp'], { m: C.marble, M: C.marbleD, p: C.stoneD })],
    throne: [rows(['g.....', 'gg....', 'gr....', 'gr....', 'grcccc', 'gggggg', 'g....g', 'g....g'], { g: C.gold, r: C.cloth[0], c: '#d86a5a' })],
    altar: [rows(['aaaaaaaa', '.AAAAAA.', '.AAggAA.', '.AAAAAA.'], { a: C.marble, A: C.marbleD, g: C.gold })],
    candle: flames(['1', 'c', 'c'], { c: C.white }),
    coffin: [rows(['.ccccccc.', 'cCCCgCCCc', '.ccccccc.'], { c: C.stoneD, C: C.stoneF, g: C.gold })],
    shelf: [
      rows(['wwwwww', 'wrgbyw', 'wrgbyw', 'wwwwww', 'wybgrw', 'wybgrw', 'wwwwww', 'wgrybw', 'wwwwww'], {
        w: C.woodD,
        r: C.books[0],
        g: C.books[1],
        b: C.books[2],
        y: C.books[3],
      }),
    ],
    gold: C.gems.map((g) => rows(['....G....', '..ggGgg..', '.ggGgegg.', 'gggggGggg'], { g: C.gold, G: C.goldL, e: I(g, true) })),
    chest: [rows(['wwwww', 'GgggG', 'wwGww', 'wwwww'], { w: C.wood, g: C.goldD, G: C.gold })],
    banner: C.cloth.map((cl) => rows(['pppp', 'cccc', 'cGGc', 'cGGc', 'cccc', 'cccc', 'c..c'], { p: C.woodD, c: cl, G: C.gold }, { ax: 1, ay: 0 })),
    winch: [rows(['p.....p', 'pbbbbbp', 'p..r..p', 'p.....p', 'p.....p'], { p: C.woodD, b: C.wood, r: C.rope })],
    torch: [rows(['w', 'w', 'm'], { w: C.woodD, m: C.metal })],
    gate: [
      rows(
        [
          '....sSSs....',
          '..ssSSSSss..',
          'sssssggsssss',
          'sSs......sSs',
          'ss........ss',
          'sS........Ss',
          'ss........ss',
          'sS........Ss',
          'ss........ss',
          'sS........Ss',
          'ss........ss',
        ],
        { s: C.stoneF, S: C.stoneL, g: C.gold },
      ),
    ],
    bat: [
      spriteFromRows(['b...b', '.bbb.'], () => I(C.bat), { outline: false }),
      spriteFromRows(['.....', 'bbbbb'], () => I(C.bat), { outline: false }),
    ],
  };
  // Mushrooms for the farm: a stalk and a cap with pale spots, in three colours and three heights.
  const CAPS = ['#c0544a', '#d8b86a', '#9a70c0'];
  S.mushroom = [0, 1, 2].map((v) => {
    const r = buffer(9, 10),
      h = 3 + v;
    lineCells(4, 8, 4, 8 - h, (x, y) => (r.px[y * r.w + x] = I('#e8dcc4')));
    fillEllipse(r, 4, 8 - h, 2.6, 1.6, I(CAPS[v]));
    r.px[(8 - h) * r.w + 3] = I('#fff0e0');
    r.px[(7 - h) * r.w + 5] = I('#fff0e0');
    outlinePass(r, INK);
    return { ...r, ax: 4, ay: 8 };
  });

  // ---------------------------------------------------------------------------------------------------- trees
  const BARK = [I('#5b3b26'), I('#87593a')],
    LEAVES = {
      round: ['#2f6b35', '#4d9a43', '#78c25a', '#a8df7c'].map((s) => I(s)),
      pine: ['#1d4433', '#2e6444', '#468556', '#6aa874'].map((s) => I(s)),
    };
  /**
   * A tree at k of its full size (it grows during the arrival). A round tree is a trunk (barkTrunk) under a crown of
   * leaf clumps (leafCrown); a pine is three crowns stacked, each smaller than the one below. Its own seed places the
   * clumps the same way at every size, so it grows rather than changes.
   */
  function buildTree(tr, k) {
    const r = buffer(28, 36),
      ax = 14,
      ay = 33,
      rnd = new SeededRandom(tr.seed),
      s = tr.size * k;
    if (s < 0.2) {
      r.px[ay * r.w + ax] = LEAVES.round[2];
      r.px[(ay - 1) * r.w + ax] = LEAVES.round[3];
    } else if (tr.kind === 'round') {
      const rx = 2.2 + 3.8 * s,
        ry = rx * 0.86,
        th = Math.max(1, Math.round(1 + 3 * s)),
        cy = ay - th - ry * 0.8;
      barkTrunk(r, ax, cy + ry * 0.3, ay, s > 0.6 ? 2 : 1, BARK, tr.lean);
      leafCrown(r, rnd, ax + tr.lean, cy, rx, ry, LEAVES.round);
    } else {
      const th = Math.max(1, Math.round(1 + 2 * s));
      barkTrunk(r, ax, ay - th - 6 * s, ay, 1, BARK, 0);
      for (let j = 0; j < 3; j++) {
        const rx = (3.6 - j * 1.05) * (0.45 + s * 0.62);
        leafCrown(r, rnd, ax, ay - th - rx * 0.55 - j * 4 * (0.45 + s * 0.55), rx, rx * 0.72, LEAVES.pine, { clumps: 4 });
      }
    }
    outlinePass(r, INK);
    return trim(r, ax, ay);
  }
  const tree = (tr, k) => cache.get(`t:${tr.id}:${Math.round(k * 10)}`, () => buildTree(tr, Math.round(k * 10) / 10));

  // ---------------------------------------------------------------------------------------------------- dwarves
  // The grid is 9 by 11: the body's 7 by 9 with a margin of one all round for the line. Templates are written in the
  // body's own columns and padded. Letters: h hair, s skin, e eye, n nose, t tunic, k belt, b beard, l legs, f boots,
  // m a helmet's metal, c a hood's or cap's cloth. A dwarf faces right; facing left is the same sprite mirrored.
  const DW = 9,
    DH = 11,
    pad = (lines) => lines.map((r) => '.' + r + '.');
  const BODY = pad(['..hhh..', '.hsse..', '..sssn.', '.ttttt.', 'tttttt.', '.ttttt.', '.kkkk..']),
    BEARD = {
      short: pad(['..bbb..', '..bbb..']),
      long: pad(['..bbbb.', '..bbbb.', '...bb..']),
    },
    HAT = {
      hair: null,
      helmet: pad(['.mmmm..', '.m.....']),
      hood: pad(['.cccc..', '.c.....', '.c.....']),
      cap: pad(['..cccc.']),
    };
  /**
   * A dwarf with its legs at a moment of its step: legA and legB are each [how far forward (-1, 0 or 1), lifted]. A
   * child has one row less of body, so it stands a pixel shorter, and no beard.
   */
  function buildDwarf(g, legA, legB) {
    const grid = Array.from({ length: DH }, () => [...'.'.repeat(DW)]);
    layTemplate(grid, BODY, 1);
    if (!g.child) layTemplate(grid, g.long ? BEARD.long : BEARD.short, 4);
    if (HAT[g.hat]) layTemplate(grid, HAT[g.hat], 1);
    [
      [3, legA],
      [5, legB],
    ].forEach(([x, [dx, up]]) => {
      grid[8][x + dx] = up ? 'f' : 'l';
      if (!up) grid[9][x + dx] = 'f';
    });
    if (g.child) {
      grid.splice(5, 1);
      grid.unshift([...'.'.repeat(DW)]);
    }
    const skin = hex(g.skin);
    const pal = {
      h: I(g.beard),
      s: idx(skin),
      e: I('#1a1418'),
      n: idx(tone(skin, -1)),
      t: I(g.tunic),
      k: I('#4a3020'),
      b: I(g.beard),
      l: I(g.trousers),
      f: I('#2e2420'),
      m: I(C.metalL),
      c: I(g.hatC),
    };
    return { w: DW, h: DH, px: outlineSprite(gridPixels(grid, pal), DW, DH, INK), ax: 4, ay: 9 };
  }
  // a dwarf at a phase of its walk (or standing), from the cache: each leg's place from footStep, rounded
  function dwarf(d, phase, moving) {
    const leg = (p) => {
      if (!moving) return [0, false];
      const st = footStep(p, 1, 1);
      return [Math.round(st.x), st.y > 0.5];
    };
    const a = leg(phase),
      b = leg(phase + Math.PI);
    return cache.get(`d:${d.id}:${a}:${b}`, () => buildDwarf(d.g, a, b));
  }

  return { S, tree, dwarf, INK, FIRE, buffer, cache };
}
