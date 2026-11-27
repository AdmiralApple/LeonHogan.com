// One frame of the hold: the rock, the caverns, the dug rooms and what stands in them, the dwarves, then the light,
// the sky, and what glows on top (flames, embers, sparks, fireflies), and the captions.
//
// A frame is painted twice. First as palette numbers into IDX (look.js): rock, water, walls, furniture, dwarves. Then
// each pixel's light is worked out (daylight near the surface, the dark underground once the torches are lit, each
// torch's circle of light, the magma's glow) and its number becomes that shade of its colour. What gives off its own
// light is drawn after, straight in colour.
import { textRows } from './font.js';

export function makeDrawing(k, look, world, pics, life) {
  const { A, used, W, H, TS, GW, GH, FPS, SEED, T, span, STAGES, CAPTIONS, timeOfDay } = k;
  // prettier-ignore
  const { bayerThreshold, blink, blitSprite, blitSway, chamferDistance, clamp, dampedSpring, ditherEllipse,
    ditheredBorder, fillEllipse, formationSlot, fractalNoise, hourLight, latticeHash, latticeRandom, lerp, lineCells,
    mixPacked, scatterAlong, shadeEllipse, smoothstep, spriteFromRows, twinkle, wallShade, waterPixel,
    waterTime } = A;
  const { hex, tone, idx, I, SH, LV, C, WP, GREYS } = look;
  const { S, tree, dwarf, INK } = pics;
  // prettier-ignore
  const { at, GN, SURF, SURFI, EX, GR, EY, GATE_X, hillX, MAT, BMI, ORE, CAVE, CAVE_T, WATER, WATER_T, D_WATER,
    FUNGUS, KIND, ROOMOF, ROOMS, DIGD, MAXD, OPEN, FREE, SY, ITEMS, LIGHTS, TORCH, LID, MAGL, D_ROCK, WELL,
    dug } = world;
  const { sim, itemAt } = life;
  const n = W * H;
  const FR = { w: W, h: H, px: new Uint32Array(n) }, // the frame in palette numbers
    IDX = FR.px,
    OUT = new Uint32Array(n), // the frame in colours
    OUTR = { w: W, h: H, px: OUT };

  // ---------------------------------------------------------------------------------------------------- the rock
  // ROCK: each pixel of undug rock as a palette number. Soil is brown with pebbles under a strip of grass; each stone
  // has bands (a sine through noise) and grain, and its top few rows are dithered into the layer above
  // (ditheredBorder), so layers meet in a ragged seam, not a line. Ore pixels take their ore's colour; gems glow.
  // CAVEB: the far wall of a cavern, the rock two tones darker. ROCKC keeps each pixel's colour for the dug walls.
  const ROCK = new Uint32Array(n),
    ROCKC = new Uint32Array(n),
    CAVEB = new Uint32Array(n),
    FUNG = new Uint32Array(n);
  const STONES = C.stone.map(hex),
    SOIL = hex(C.soil),
    ORES = C.ore.map((s) => s && hex(s)),
    FUNGI = C.fungus.map((s) => I(s, true));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = at(x, y),
        m = MAT[i];
      if (!m) continue;
      const v = latticeRandom(x, y, SEED + 32);
      let c,
        kk = 0,
        base;
      if (m === 1) {
        const dy = y - SURFI[x];
        base = SOIL;
        if (dy < 2) c = hex(dy === 0 ? C.grassLit : C.grass);
        else {
          c = v > 0.985 ? STONES[0] : SOIL;
          kk = v < 0.12 ? -1 : v > 0.93 ? 1 : 0;
        }
      } else {
        let mm = m === 5 ? 4 : m;
        for (let d = 1; d <= 3 && y - d >= 0; d++) {
          const up = MAT[i - d * W];
          if (up !== mm && up >= 1 && up < mm) {
            if (ditheredBorder((4 - d) / 8, x, y, v)) mm = up;
            break;
          }
        }
        base = mm === 1 ? SOIL : STONES[mm - 2];
        c = base;
        const band = Math.sin(y * 0.8 + fractalNoise(x / 30, y / 30, SEED + 31, 2) * 9);
        kk = (band > 0.6 ? 1 : band < -0.65 ? -1 : 0) + (v < 0.07 ? -1 : v > 0.96 ? 1 : 0);
        const o = ORE[i];
        if (o === 6) {
          ROCK[i] = idx(hex(C.gems[latticeHash(x, y, SEED) & 3]), true);
          ROCKC[i] = base;
          CAVEB[i] = idx(tone(base, -2));
          continue;
        }
        if (o) {
          c = ORES[o];
          kk = v < 0.3 ? -1 : v > 0.8 ? 1 : 0;
        }
      }
      const col = tone(c, kk);
      ROCKC[i] = col;
      ROCK[i] = idx(col);
      if (CAVE[i]) {
        CAVEB[i] = idx(tone(base, v < 0.15 ? -2 : -1 - (((x >> 1) + (y >> 2)) & 1)));
        if (FUNGUS[i]) FUNG[i] = FUNGI[latticeHash(x >> 1, y >> 1, SEED + 3) % 3];
      }
    }

  // ---------------------------------------------------------------------------------------------------- the walls
  // BACK: the far wall of each dug tile, by what it is. The stairs zigzag down the shaft; corridors and tunnels are the
  // rock itself, cut back and darker; rooms are finished in their own way: dressed stone in courses (wallShade) with
  // a frieze for the hall, the temple and the vault, planks for bedrooms and the library, tiles in the kitchen. Every
  // wall darkens toward the rock round it (a shade measured with chamferDistance), and the bottom row of each tile is
  // its floor.
  const DUGPX = new Uint8Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) DUGPX[at(x, y)] = dug(x >> 2, y >> 2) && MAT[at(x, y)] ? 1 : 0;
  const D_EDGE = chamferDistance(DUGPX, W, H);
  const BACK = new Uint32Array(n),
    RUB = new Uint32Array(n);
  const masonry = (tint, x, y) => {
    const l = wallShade('stone', x & 15, y & 15);
    return [hex(tint), l < 0.6 ? -2 : l < 0.8 ? -1 : l > 0.95 ? 1 : 0];
  };
  const FLOOR = { hall: '#8a8278', temple: '#b8b0a4', vault: '#b8b0a4', tomb: '#5a5660', forge: '#5a5250', beds: C.woodL, library: C.woodL, workshop: C.woodL, kitchen: '#a08060', farm: '#5a4430' };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      if (!DUGPX[i]) continue;
      const tl = (y >> 2) * GW + (x >> 2),
        kd = KIND[tl],
        room = ROOMOF[tl] >= 0 ? ROOMS[ROOMOF[tl]] : null,
        type = room ? room.type : null,
        rough = kd === 2 || kd === 4 || type === 'store';
      let col, kk;
      if (kd === 1) {
        const u = x - ((x >> 2) - (KIND[tl - 1] === 1 ? 1 : 0)) * TS, // across this two-tile stair, 0..7
          s = (y >> 3) & 1 ? 7 - (y & 7) : y & 7;
        [col, kk] = u === s ? [hex(C.woodL), 0] : u === s + 1 && (y & 1) === 0 ? [hex(C.woodD), 0] : masonry('#7a7266', x, y);
      } else if (rough) [col, kk] = [ROCKC[i], latticeRandom(x, y, SEED + 36) < 0.1 ? -1 : -2];
      else if (kd === 5) [col, kk] = masonry('#5e5a56', x, y);
      else {
        const fy = y - room.top * TS; // rows down from the room's ceiling
        if (type === 'hall') [col, kk] = fy === 3 || fy === 4 ? [hex(((x >> 1) + y) & 3 ? '#8a7a68' : C.goldD), 0] : masonry('#9a8a78', x, y);
        else if (type === 'temple') [col, kk] = fy === 3 ? [hex(C.goldD), (x & 3) === 0 ? 1 : 0] : masonry('#d0c8bc', x, y);
        else if (type === 'vault') [col, kk] = fy === 2 || fy === 3 ? [hex(C.gold), (x + fy) & 1 ? 0 : -1] : masonry('#c8bfae', x, y);
        else if (type === 'tomb') [col, kk] = masonry('#4a4650', x, y);
        else if (type === 'forge') {
          [col, kk] = masonry('#5a5250', x, y);
          if (fy < 6) kk -= 1; // soot under the ceiling
        } else if (type === 'beds') [col, kk] = [hex('#8a6040'), x % 5 === 0 ? -1 : latticeRandom(x, y, SEED + 37) < 0.02 ? -2 : 0];
        else if (type === 'library') [col, kk] = [hex('#6a4a30'), x % 4 === 0 ? -1 : 0];
        else if (type === 'workshop') [col, kk] = [hex('#94724c'), y % 3 === 0 ? -1 : 0];
        else if (type === 'kitchen') [col, kk] = [hex(((x >> 1) + (y >> 1)) & 1 ? '#c8a07a' : '#b08a66'), 0];
        else if (type === 'farm') [col, kk] = [hex('#4a3a2a'), latticeRandom(x, y, SEED + 33) < 0.08 ? 1 : 0];
        else [col, kk] = masonry('#8a8278', x, y);
      }
      const de = D_EDGE[i];
      if (de <= 3) kk -= 2;
      else if (de <= 7) kk -= 1;
      // the floor: the bottom row of a tile with rock (or the well's cover) under it
      const below = (y >> 2) + 1 < GH ? KIND[tl + GW] : 0;
      if ((y & 3) === 3 && (!below || below === 5) && kd !== 1) {
        col = rough || !FLOOR[type] ? ROCKC[i] : hex(FLOOR[type]);
        kk = rough ? 1 : (x & 7) === 0 ? -1 : 1;
      }
      BACK[i] = idx(tone(col, clamp(kk, -2, 2)));
      if (latticeRandom(x, y, SEED + 50) < 0.3) RUB[i] = idx(tone(ROCKC[i], 1)); // rubble, while a tile is freshly dug
    }
  // door posts where a corridor meets a room, a post each side of the opening and a lintel over it
  for (const r of ROOMS)
    for (const [edge, out, dir] of [
      [r.x0 * TS, r.x0 - 1, 1],
      [(r.x1 + 1) * TS - 1, r.x1 + 1, -1],
    ]) {
      if (!dug(out, r.floor) || KIND[r.floor * GW + out] === 1) continue;
      const y0 = (r.floor - 2) * TS;
      for (let y = y0; y <= (r.floor + 1) * TS - 2; y++) BACK[at(edge, y)] = I(C.woodD);
      if (r.top < r.floor - 2) for (let x = 0; x < 3; x++) BACK[at(edge + dir * x, y0)] = I(C.woodD);
    }

  // ---------------------------------------------------------------------------------------------------- the surface
  // tufts of grass and a few flowers along the ground, trees (none near the gate), the gate itself
  const TUFTS = [];
  for (let x = 0; x < W; x++) {
    const y = SURFI[x] - 1,
      v = latticeRandom(x, 0, SEED + 34);
    if (y < 0 || Math.abs(x - GATE_X) < 8) continue;
    if (v < 0.35) TUFTS.push([at(x, y), I(C.grassLit)]);
    else if (v > 0.965) TUFTS.push([at(x, y), I(['#fff4e0', '#ffd75a', '#ff9fb8', '#c9a9ff'][latticeHash(x, 1, SEED) & 3])]);
  }
  const TREES = scatterAlong(6, W - 6, 19, SEED + 35, { chance: 0.62 })
    .filter((s) => Math.abs(s.x - GATE_X) > 24)
    .map((s, j) => ({
      id: j,
      x: Math.round(s.x),
      y: SURFI[Math.round(s.x)] - 1,
      seed: SEED + j * 7,
      size: s.size,
      kind: s.variant === 0 ? 'pine' : 'round',
      lean: (s.variant - 1.5) * 0.4,
      appear: latticeRandom(j, 3, SEED) * 0.6,
    }));
  // gems sparkle now and then, each on its own beat (blink)
  const GEMS = [];
  for (let i = 0; i < n; i++) if (ORE[i] === 6) GEMS.push({ x: i % W, y: (i / W) | 0, ph: latticeRandom(i, 9, SEED) * 6.3 });

  // ---------------------------------------------------------------------------------------------------- the seed
  // The seed's noise at one octave, two, three and four (o = 0..3), for the opening, and a grain for the reveal's
  // order. Each row is worked out the first time it is shown, so a tall hold behind a page starts at once, and all of
  // it is let go once the rock has been revealed (a hold that starts already built never makes any of it).
  let OCT_ = null,
    GRN_ = null;
  function oct(o, y0, y1) {
    OCT_ = OCT_ || [0, 1, 2, 3].map(() => ({ a: new Float32Array(n), done: new Uint8Array(H) }));
    const { a, done } = OCT_[o];
    for (let y = y0; y < y1; y++)
      if (!done[y]) {
        done[y] = 1;
        for (let x = 0; x < W; x++) a[at(x, y)] = fractalNoise(x / 40, y / 40, SEED + 60, o + 1, 0.55);
      }
    return a;
  }
  function grn(y0, y1) {
    GRN_ = GRN_ || { a: new Float32Array(n), done: new Uint8Array(H) };
    const { a, done } = GRN_;
    for (let y = y0; y < y1; y++)
      if (!done[y]) {
        done[y] = 1;
        for (let x = 0; x < W; x++) a[at(x, y)] = latticeRandom(x, y, SEED + 61);
      }
    return a;
  }
  // a height (0..1) as one of the nine greys, the steps between them dithered (bayerThreshold)
  const greyOf = (v, x, y) => GREYS[clamp(Math.floor(clamp((v - 0.22) / 0.56) * 8 + bayerThreshold(x, y)), 0, 8)];

  // ---------------------------------------------------------------------------------------------------- the light
  // AMB: how much light each pixel has underground once the torches are lit, before the torches' own: open space a
  // little, rock face less, and rock deep in the mountain least (by its distance from open space). DEPTH: how far
  // below the surface a pixel is, from 0 (in daylight) to 1 (as deep as daylight goes).
  const AMB = new Float32Array(n),
    DEPTH = new Float32Array(n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      AMB[i] = OPEN[i] ? 0.4 : 0.4 + 0.06 * Math.max(0, 1 - D_ROCK[i] / 3 / 12);
      DEPTH[i] = smoothstep(0, 14, y - SURF[x]);
    }
  const LF = new Float32Array(LIGHTS.length); // each light's strength this frame
  const MAGMA = C.magma.map((s) => I(s, true));
  /** The magma at a pixel: noise drifting slowly, brighter near the top, its crust brightest. */
  function magmaAt(x, y, t) {
    const d = y - BMI[x];
    if (d === 0) return MAGMA[latticeRandom(x, (t * 4) | 0, SEED) < 0.3 ? 5 : 4];
    // two drifts of noise, one broad and slow, one fine and quicker, so a deep sea of it still churns; it darkens a
    // little with depth, but only so far
    const v = fractalNoise(x / 9 + t * 0.5, y / 3.5 - t * 0.25, SEED + 40, 2) * 0.65 + fractalNoise(x / 26 - t * 0.2, y / 9 + t * 0.15, SEED + 41, 2) * 0.35;
    return MAGMA[clamp(Math.floor((v * 1.6 - 0.2 - Math.min(d, 12) * 0.03) * 5.5), 0, 5)];
  }
  // A dropped thing's height above where it lands, frame by frame after it appears: a spring pulled down to the
  // floor that overshoots and settles (dampedSpring).
  const DROP = [];
  for (let x = -8, v = 0, f = 0; f < 24; f++) {
    DROP.push(Math.round(x));
    [x, v] = dampedSpring(x, v, 0, 260, 11, 1 / FPS);
  }
  const drop = (since) => DROP[Math.min(DROP.length - 1, Math.max(0, Math.floor(since * FPS)))];

  // ---------------------------------------------------------------------------------------------------- the sky
  const SKYH = Math.max(...SURFI) + 1,
    SKY = { w: W, h: SKYH, px: new Uint32Array(W * SKYH) };
  const GRAD = {
    day: [hex('#5aa8e6'), hex('#c2e4f0')],
    dusk: [hex('#3a3c80'), hex('#f2a06a')],
    night: [hex('#060a1c'), hex('#1a2244')],
  };
  const STARS = [];
  for (let j = 0; j < 70; j++) STARS.push({ x: Math.floor(latticeRandom(j, 1, SEED) * W), y: Math.floor(latticeRandom(j, 2, SEED) * SKYH * 0.8), ph: latticeRandom(j, 3, SEED) * 6.3 });
  const CLOUDS = [0, 1, 2, 3, 4].map((j) => ({ x: latticeRandom(j, 4, SEED) * W, y: 5 + latticeRandom(j, 5, SEED) * 12, s: 0.7 + latticeRandom(j, 6, SEED) * 0.6, v: 3 + latticeRandom(j, 7, SEED) * 4 }));
  const WHITE = hex('#f4f2ee'),
    STAR = hex(C.star),
    MOON = hex('#f2eedc');
  /** The sky at second t: its colours for the hour (hourLight), drifting clouds, and at night the moon and stars. */
  function paintSky(t, hl) {
    const px = SKY.px;
    for (let y = 0; y < SKYH; y++) {
      const u = y / SKYH;
      let c = mixPacked(GRAD.day[0], GRAD.day[1], u);
      c = mixPacked(c, mixPacked(GRAD.night[0], GRAD.night[1], u), hl.night);
      c = mixPacked(c, mixPacked(GRAD.dusk[0], GRAD.dusk[1], u), hl.dusk * 0.85);
      px.fill(c, y * W, (y + 1) * W);
    }
    if (hl.night > 0.05)
      for (const s of STARS) {
        const i = s.y * W + s.x;
        px[i] = mixPacked(px[i], STAR, clamp(hl.night * twinkle(t, s.ph, 0.5)));
      }
    if (hl.night > 0.4) fillEllipse(SKY, W * 0.78, 9, 3.5, 3.5, mixPacked(px[9 * W + Math.round(W * 0.78)], MOON, hl.night));
    const cloud = mixPacked(WHITE, mixPacked(GRAD.night[0], GRAD.night[1], 0.5), hl.night * 0.85);
    for (const c of CLOUDS) {
      const x = ((c.x + t * c.v) % (W + 60)) - 30;
      ditherEllipse(SKY, x, c.y, 9 * c.s, 2.6 * c.s, cloud, 0.85);
      ditherEllipse(SKY, x + 5 * c.s, c.y - 2, 6 * c.s, 2.4 * c.s, cloud, 0.9);
      ditherEllipse(SKY, x - 6 * c.s, c.y + 0.5, 5 * c.s, 1.8 * c.s, cloud, 0.7);
    }
  }

  // ---------------------------------------------------------------------------------------------------- tools
  const WOODI = I(C.wood),
    METALI = I(C.metalL);
  const plot = (c) => (x, y) => {
    if (x >= 0 && y >= 0 && x < W && y < H) IDX[y * W + x] = c;
  };
  /**
   * A pick or a hammer in a dwarf's hand, raised or brought down: the handle a line from the hand, the head a short
   * line across its end. Returns where the head is, for sparks.
   */
  function tool(x, y, dir, down, kind) {
    const hx = x + 2 * dir,
      hy = y - 4,
      ex = down ? x + 6 * dir : x + 3 * dir,
      ey = down ? y - 4 : y - 9;
    lineCells(hx, hy, ex, ey, plot(WOODI));
    const vx = ex - hx,
      vy = ey - hy,
      l = Math.hypot(vx, vy) || 1,
      px = (-vy / l) * (kind === 'pick' ? 1.6 : 0.8),
      py = (vx / l) * (kind === 'pick' ? 1.6 : 0.8);
    lineCells(ex - px, ey - py, ex + px, ey + py, plot(METALI));
    return [ex + (vx / l) * 1.5, ey + (vy / l) * 1.5];
  }
  const SPARKS = [];

  // ---------------------------------------------------------------------------------------------------- the frame
  /**
   * The frame at second t, in palette numbers: the rock, the caverns as they open and fill, the dug tiles, then what
   * stands on the ground and in the rooms, and the dwarves and bats.
   */
  function paintIndex(t, fr) {
    const caveOn = t >= T.caves[0],
      caveU = span('caves', t),
      waterU = clamp(caveU * 1.5 - 0.45),
      DA = sim.digAt, // when each tile was dug by the dwarves (Infinity: not yet), if the dig has begun
      fungusOn = t >= T.caves[0] + 0.7,
      WT = waterTime(t, Math.floor(t * 15));
    for (let y = Y0, i = Y0 * W; y < Y1; y++) {
      const wob = Math.round(Math.sin(y * 0.35 + t * 2.2)),
        trow = (y >> 2) * GW;
      for (let x = 0; x < W; x++, i++) {
        const m = MAT[i];
        if (!m) {
          IDX[i] = 0;
          continue;
        }
        if (m === 5) {
          IDX[i] = caveOn ? magmaAt(x, y, t) : ROCK[i];
          continue;
        }
        const tl = trow + (x >> 2);
        if (DA && DA[tl] <= t) {
          IDX[i] = t - DA[tl] < 0.6 && RUB[i] ? RUB[i] : BACK[i]; // rubble for a moment, where it was just dug
          continue;
        }
        if (CAVE[i] && caveU > CAVE_T[i]) {
          IDX[i] =
            WATER[i] && waterU > WATER_T[i]
              ? waterPixel(x, y, D_WATER[i] / 3, false, 0, WT, wob, WP)
              : FUNG[i] && fungusOn
                ? FUNG[i]
                : CAVEB[i];
          continue;
        }
        IDX[i] = ROCK[i];
      }
    }
    if (t >= T.strata[0] + 0.3) for (const [i, c] of TUFTS) IDX[i] = c;
    // trees grow, each at its own moment of the arrival
    if (t >= T.embark[0]) {
      const u = span('embark', t);
      for (const tr of TREES) {
        const g = smoothstep(0, 1, (u - tr.appear) / 0.35);
        if (g > 0) blitSprite(FR, tree(tr, g), tr.x, tr.y);
      }
      blitSprite(FR, S.gate[0], GATE_X, EY - 1 - drop(t - T.embark[0]));
    }
    // what stands in the rooms, each dropping into place soon after its room is dug out (wall hangings sway)
    for (const it of ITEMS) {
      if (it.y < Y0 - 4 || it.y > Y1 + 24) continue; // out of view
      const at0 = itemAt(it);
      if (!(t >= at0)) continue; // not yet placed
      const list = S[it.kind],
        fire = it.kind === 'furnace' || it.kind === 'oven',
        sp = fire ? list[(fr + it.x) % 3] : list[it.v % list.length],
        y = it.y - (it.wall ? 0 : drop(t - at0));
      if (it.wall) blitSway(FR, sp, it.x, y, (h) => -h * 0.12 * Math.sin(t * 1.7 + it.x));
      else if (it.kind === 'mushroom') blitSway(FR, sp, it.x, y, (h) => h * 0.16 * Math.sin(t * 2 + it.x * 0.7));
      else blitSprite(FR, sp, it.x, y, it.flip);
      if (it.kind === 'altar') for (const dx of [-3, 0, 3]) blitSprite(FR, S.candle[(fr + dx + 3) % 3], it.x + dx, y - 5);
    }
    // the well: a rope down from the winch to a bucket going up and down
    const winch = WELL && ITEMS.find((it) => it.kind === 'winch'),
      wellAt = winch ? itemAt(winch) : Infinity;
    if (WELL && t >= wellAt) {
      const x = WELL.x * TS + 2,
        top = SY(WELL.f) - 3,
        by = Math.round(lerp(WELL.top + 3, WELL.water - 1, 0.5 - 0.5 * Math.cos((t - wellAt) * 0.9)));
      lineCells(x, top, x, by - 2, plot(I(C.rope)));
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 0; dy++) plot(I(C.woodD))(x + dx, by + dy);
    }
    // torches, once lit
    const lu = span('lights', t);
    for (const L of LIGHTS) if (L.kind === 'torch' && lu > L.appear) blitSprite(FR, S.torch[0], L.x, L.y + 3);
    SPARKS.length = 0;
    paintDwarves(t);
    if (sim.bats) for (const b of sim.bats) blitSprite(FR, S.bat[(fr + Math.floor(b.seed * 3)) % 2], b.x, b.y, b.dir < 0);
  }

  /**
   * The dwarves, every one where life has walked it: over the grass to the gate, at the dig with a pick going up and
   * down (and sparks off the rock), and once the hold is dug, a tool in hand while it works.
   */
  function paintDwarves(t) {
    if (sim.dw)
      for (const w of sim.dw) {
        if (w.hidden || w.sleeping) continue;
        const x = Math.round(w.x),
          y = Math.round(w.y);
        if (y < Y0 - 16 || y > Y1 + 16) continue; // out of view
        blitSprite(FR, dwarf(w.d, w.phase, w.moving), x, y, w.dir < 0);
        if (w.digging) {
          const down = Math.floor(t * 6 + w.d.id * 0.37) % 2 === 1,
            head = tool(x, y, w.dir, down, 'pick');
          if (down) SPARKS.push([head[0], head[1], w.d.id]);
        } else if (w.working && (w.d.job === 'mine' || w.d.job === 'forge' || w.d.job === 'workshop')) {
          const down = Math.floor(t * 5 + w.d.id * 0.37) % 2 === 1,
            head = tool(x, y, w.dir, down, w.d.job === 'mine' ? 'pick' : 'hammer');
          if (down && w.d.job !== 'workshop') SPARKS.push([head[0], head[1], w.d.id]);
        }
      }
  }

  /**
   * The light: each palette number becomes its shade for the light at its pixel. Near the surface that is the hour's
   * daylight; underground it is full light while the hold is built (a cut-away drawing), then, as the torches are lit,
   * the dark's own (AMB) plus each torch's circle (TORCH, following its torch's flicker) and the magma's glow.
   */
  function light(t, hl) {
    const day = 1 - hl.night * 0.62 - hl.dusk * 0.15,
      dark = smoothstep(0, 1, span('lights', t)) * k.darkness,
      lu = span('lights', t),
      magK = t >= T.caves[0] ? smoothstep(T.caves[0], T.caves[1], t) * (0.9 + 0.1 * Math.sin(t * 1.3)) * (0.35 + 0.65 * dark) : 0;
    for (const L of LIGHTS)
      LF[L.id] = (L.kind === 'torch' ? (lu > L.appear ? 1 : 0) : lu > 0 ? 1 : 0) * dark * (0.88 + 0.08 * Math.sin(t * 13 + L.id * 2.3) + 0.04 * Math.sin(t * 29 + L.id));
    const sky = SKY.px;
    for (let i = Y0 * W, end = Y1 * W; i < end; i++) {
      const v = IDX[i];
      if (!v) {
        OUT[i] = i < SKY.px.length ? sky[i] : 0;
        continue;
      }
      let b = day + (1 + (AMB[i] - 1) * dark - day) * DEPTH[i];
      const l = LID[i];
      if (l >= 0) b += TORCH[i] * LF[l];
      b += MAGL[i] * magK;
      const L = (b * 10 + 0.5) | 0;
      OUT[i] = SH[(v - 1) * LV + (L < 0 ? 0 : L > 15 ? 15 : L)];
    }
  }

  // ---------------------------------------------------------------------------------------------------- what glows
  const P = (s) => hex(s);
  const FIRE = C.fire.map(P),
    EMBER = P(C.ember),
    DRIP = P(C.drip),
    SPARK = P(C.spark),
    ZZZ = P(C.zzz),
    FLY = P(C.firefly),
    GLINT = P('#ffffff');
  const put = (x, y, c) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < W && y < H) OUT[y * W + x] = c;
  };
  const Z = ['###', '.#.', '###']; // a z, three pixels square
  function glows(t, fr, hl) {
    const lu = span('lights', t);
    for (const L of LIGHTS) {
      if (L.kind !== 'torch' || lu <= L.appear) continue;
      const f = (fr + L.id) % 3;
      put(L.x, L.y, FIRE[1]);
      put(L.x, L.y - 1, FIRE[f === 2 ? 1 : 0]);
      if (f === 0) put(L.x, L.y - 2, FIRE[2]);
    }
    for (const g of GEMS) if (blink(t, 2.3, g.ph, 0.95)) put(g.x, g.y, GLINT);
    if (sim.embers)
      for (const q of sim.embers) if (q.life > 0 && (q.src.magma || t >= T.furnish[0])) put(q.x, q.y, q.life < 0.5 ? FIRE[0] : EMBER);
    if (sim.drips)
      for (const q of sim.drips) {
        if (q.wait > 0) continue;
        if (q.splash > 0) {
          put(q.x - 1, q.y - 1, DRIP);
          put(q.x + 1, q.y - 1, DRIP);
        } else put(q.x, q.y, DRIP);
      }
    for (const [x, y, j] of SPARKS)
      for (let s = 0; s < 3; s++) {
        const a = latticeRandom(j, s + Math.floor(t * 5) * 3, SEED) * Math.PI - Math.PI,
          r = 1.5 + latticeRandom(s, j, SEED + 1) * 3;
        put(x + Math.cos(a) * r, y + Math.sin(a) * r, SPARK);
      }
    for (const z of sim.zs) {
      const c = mixPacked(ZZZ, OUT[clamp(Math.round(z.y), 0, H - 1) * W + clamp(Math.round(z.x), 0, W - 1)], clamp(z.life / 1.6));
      Z.forEach((row, dy) => [...row].forEach((ch, dx) => ch === '#' && put(z.x + dx, z.y + dy - 3, c)));
    }
    if (hl.night > 0.1 && sim.flies)
      for (const q of sim.flies) {
        const x = clamp(Math.round(q.x), 0, W - 1),
          y = SURFI[x] - q.h + q.y,
          i = clamp(Math.round(y), 0, H - 1) * W + x;
        OUT[i] = mixPacked(OUT[i], FLY, clamp(hl.night * twinkle(t, q.p * 3, 0.7)));
      }
  }
  // contact shadows under the dwarves, on the floor strip
  function shadows() {
    if (sim.dw) for (const w of sim.dw) if (!w.hidden && !w.sleeping) shadeEllipse(OUTR, Math.round(w.x), Math.round(w.y) + 1, 3, 0.5, 0.62);
  }

  // ---------------------------------------------------------------------------------------------------- captions
  const TXT = hex(C.text),
    ACC = hex(C.accent),
    TINK = hex(C.textInk);
  const CAP = new Map();
  function makeCaption(lines, chars, big = false) {
    let left = chars;
    const rows = [];
    for (const line of lines) {
      const shown = line.slice(0, Math.max(0, left));
      left -= line.length;
      rows.push(...textRows(shown, { big }), ...(big ? ['.', '.', '.', '.'] : ['.', '.']));
    }
    const width = Math.max(1, ...rows.map((r) => r.length));
    return spriteFromRows(
      rows.map((r) => r.padEnd(width, '.')),
      (ch) => (ch === '+' ? ACC : TXT),
      { ink: TINK, ax: 0, ay: 0 },
    );
  }
  const caption = (lines, chars) => {
    const key = lines.join('|') + ':' + chars;
    return CAP.get(key) || (CAP.set(key, makeCaption(lines, chars)), CAP.get(key));
  };
  const MARK = spriteFromRows(textRows('procedural-almanac'), () => hex(C.mark), { ink: TINK, ax: 0, ay: 0 });
  // when the caption showing now began, so it can type itself out from its start
  let capKey = null,
    capFrom = 0;
  /** The library's name in the corner, the caption of the moment typing itself out, and the end card. */
  function finish(t) {
    if (k.mark) blitSprite(OUTR, MARK, 4, 3);
    const key = k.captionAt(t);
    if (key !== capKey || t < capFrom) {
      capKey = key;
      capFrom = key && T[key] ? T[key][0] : t;
    }
    if (key && CAPTIONS[key]) {
      const sp = caption(CAPTIONS[key], Math.floor((t - capFrom) * 150));
      blitSprite(OUTR, sp, 4, H - 4 - sp.h);
    }
    if (k.endCard(t)) {
      const card = CAP.get('end') || (CAP.set('end', makeCaption(['one seed, one hold'], 99, true)), CAP.get('end'));
      const sub = caption([`${used.size} techniques · no image files`, '`procedural-almanac`'], 99);
      blitSprite(OUTR, card, (W - card.w) >> 1, (H >> 1) - 40);
      blitSprite(OUTR, sub, (W - sub.w) >> 1, (H >> 1) - 14);
    }
    return OUT;
  }

  /**
   * The frame at second t: all of it, or only the rows from y0 to y1 (a tall hold behind a page that scrolls paints
   * just the rows in view; the rest of OUT is left as it was).
   */
  function frame(t, y0 = 0, y1 = H) {
    Y0 = Math.max(0, Math.floor(y0));
    Y1 = Math.min(H, Math.ceil(y1));
    const fr = Math.round(t * FPS);
    if (t < T.strata[0]) {
      const a = oct(Math.min(3, Math.floor(span('seed', t) * 4)), Y0, Y1);
      for (let y = Y0, i = Y0 * W; y < Y1; y++) for (let x = 0; x < W; x++, i++) OUT[i] = greyOf(a[i], x, y);
      return finish(t);
    }
    if (t >= T.caves[0] && (OCT_ || GRN_)) OCT_ = GRN_ = null; // the seed's noise is not wanted again
    const hl = hourLight(timeOfDay(t));
    if (Y0 < SKYH) paintSky(t, hl);
    paintIndex(t, fr);
    light(t, hl);
    shadows();
    glows(t, fr, hl);
    // The rock condenses out of the seed's noise: each pixel turns to rock when the stage reaches its own moment, the
    // bright parts of the noise first (so the clouds of light grey harden first and the dark gaps fill in after) and a
    // little sooner near the top; the turn is dithered (ditheredBorder), so each cloud's edge goes over grain by grain.
    if (t < T.strata[1]) {
      const u = span('strata', t) * 1.3 - 0.15,
        G = grn(Y0, Y1),
        a = oct(3, Y0, Y1);
      for (let y = Y0, i = Y0 * W; y < Y1; y++) {
        const deep = (y / H) * 0.3;
        for (let x = 0; x < W; x++, i++) {
          const when = 0.7 * (1 - clamp((a[i] - 0.22) / 0.56)) + deep;
          if (!ditheredBorder(clamp((u - when) / 0.14), x, y, G[i])) OUT[i] = greyOf(a[i], x, y);
        }
      }
    }
    return finish(t);
  }
  let Y0 = 0,
    Y1 = H; // the rows being painted this frame

  return { frame, TREES };
}
