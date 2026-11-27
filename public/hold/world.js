// The hold's world, seen as a cut through the mountain: the surface and its hill, the rock in layers (soil, then three
// stones, each deeper one darker) with veins of ore and a few gems, natural caverns low down with a lake and glowing
// fungus, magma at the bottom, and the hold itself: a stair shaft down from the gate, levels of corridors and rooms
// off it, mine tunnels at the far ends, and a well down to the lake. Then where everything in the rooms stands, where
// the torches hang, the order the rock is dug in, and which tiles a dwarf can stand on.
//
// Two grids: pixels (W x H) for the rock, and tiles of TS x TS pixels (GW x GH) for what is dug. A dwarf stands on a
// tile; its feet are on the floor strip, the bottom row of pixels of the tile.

/**
 * Builds the world for the scene's seed.
 *
 * How it works, in order: the surface line from noise, with a hill to one side and a level spot for the gate near the
 * middle; how deep the hold's levels are (they depend only on where the gate is); the rock pixel by pixel; the caverns
 * below the deepest level, their stalactites, their water and their fungus; the plan of the hold, tile by tile; room
 * types; the well; the order of digging; and what goes in the rooms.
 */
export function buildWorld(k, look) {
  const { A, W, H, TS, GW, GH, SEED } = k;
  // prettier-ignore
  const { SeededRandom, capsuleSteps, chamferDistance, clamp, floodFill, fractalNoise, latticeRandom, lerp,
    nearestFreeCell, noiseLine, ridgedNoise, scatterAlong, segmentClear, smoothstep, untilSettled } = A;
  const rng = new SeededRandom(SEED),
    n = W * H,
    at = (x, y) => y * W + x;

  // ---------------------------------------------------------------------------------------------------- the surface
  // A rolling line, lifted into a hill toward one edge. The gate's column (EX, in tiles) is where the line is most
  // level near the middle, and the ground round it is pressed flat to a tile's edge (EY), so the shaft starts clean.
  const hillRight = rng.chance(0.5),
    hillX = hillRight ? rng.range(0.8, 0.96) * W : rng.range(0.04, 0.2) * W,
    hillW = rng.range(70, 110),
    hillH = rng.range(12, 24);
  const rawSurf = (x) =>
    34 +
    (noiseLine(x / 55, SEED) - 0.5) * 14 +
    (fractalNoise(x / 16, 3.7, SEED + 9, 3) - 0.5) * 4 -
    hillH * smoothstep(0, 1, 1 - Math.abs(x - hillX) / hillW);
  let EX = 48,
    best = 1e9;
  for (let tx = Math.round(GW * 0.36); tx <= Math.round(GW * 0.6); tx++) {
    const px = tx * TS + 4,
      score = Math.abs(rawSurf(px - 8) - rawSurf(px + 16)) + Math.abs(tx - GW * 0.48) * 0.08 + rng.next() * 0.4;
    if (score < best) {
      best = score;
      EX = tx;
    }
  }
  const GR = Math.round(rawSurf(EX * TS + 4) / TS), // the tile row the ground starts at, at the gate
    EY = GR * TS,
    GATE_X = EX * TS + 4; // the middle of the shaft, in pixels
  const SURF = new Float32Array(W),
    SURFI = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    SURF[x] = lerp(rawSurf(x), EY, 1 - smoothstep(10, 28, Math.abs(x - GATE_X)));
    SURFI[x] = Math.round(SURF[x]);
  }

  // ---------------------------------------------------------------------------------------------------- the levels
  // Floors, in tile rows: the first a few rows under the gate, then one every SP rows, down to about three quarters of
  // the way, leaving room below for the caverns. In a tall world the hold comes in groups of a dozen levels with a
  // band of natural caverns between each group and the next (GAPS, in pixels), which the stairs go down through.
  const SP = rng.int(6, 8),
    HMAX = Math.min(6, SP - 2), // the tallest a room can be
    FLOORS = [],
    GAPS = [],
    GROUP = [];
  {
    const bottom = Math.min(GH - 22, Math.round(GH * (GH >= 180 ? 0.84 : 0.78)));
    let f = GR + rng.int(5, 7),
      inGroup = 0;
    while (f <= bottom && FLOORS.length < 80) {
      FLOORS.push(f);
      GROUP.push(GAPS.length); // which group of levels this one is in: 0 the first, under the gate
      inGroup++;
      if (GH >= 180 && inGroup >= 12 && f + 44 < bottom) {
        const gap = rng.int(28, 38);
        GAPS.push({ top: (f + 1) * TS + 12, bot: (f + gap - HMAX) * TS - 12 });
        f += gap;
        inGroup = 0;
      } else f += SP;
    }
  }
  const LAST = FLOORS.length - 1,
    DEEP = FLOORS[LAST];

  // ---------------------------------------------------------------------------------------------------- the rock
  // What each pixel is made of: 0 air, 1 soil, 2 the upper stone, 3 the middle stone, 4 the deep stone, 5 magma. The
  // borders between layers wander with noise along the line.
  const B1 = (x) => SURF[x] + 7 + noiseLine(x / 24, SEED + 1) * 6,
    B2 = (x) => H * 0.42 + (noiseLine(x / 48, SEED + 2) - 0.5) * 22,
    B3 = (x) => H * 0.66 + (noiseLine(x / 40, SEED + 3) - 0.5) * 18,
    BM = (x) => H - 10 + (noiseLine(x / 18, SEED + 4) - 0.5) * 6;
  const MAT = new Uint8Array(n),
    BMI = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    const b1 = B1(x),
      b2 = B2(x),
      b3 = B3(x),
      bm = BM(x);
    BMI[x] = Math.round(bm);
    for (let y = 0; y < H; y++)
      MAT[at(x, y)] = y < SURFI[x] ? 0 : y < b1 ? 1 : y < b2 ? 2 : y < b3 ? 3 : y < bm ? 4 : 5;
  }
  // Ore: ridged noise is high along thin winding lines, which is how veins run. Each stone has its own ores, and only
  // some pixels of a vein are ore, so it reads as flecks in the rock. 1 coal, 2 copper, 3 iron, 4 silver, 5 gold, 6 gem.
  const ORE = new Uint8Array(n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = at(x, y),
        m = MAT[i];
      if (m < 2 || m > 4) continue;
      const fleck = latticeRandom(x, y, SEED + 22) < 0.6;
      if (m === 4 && latticeRandom(x, y, SEED + 24) < 0.0022) ORE[i] = 6;
      else if (fleck && ridgedNoise(x / 26, y / 11, SEED + 20 + m, 3) > 0.9)
        ORE[i] =
          m === 2
            ? fractalNoise(x / 60, y / 60, SEED + 21, 2) > 0.5
              ? 2
              : 1
            : m === 3
              ? latticeRandom(x >> 3, y >> 3, SEED + 25) < 0.3
                ? 4
                : 3
              : 5;
    }

  // ---------------------------------------------------------------------------------------------------- the caverns
  // Open where fractal noise is high, in bands: one from a little under the deepest level down to just above the
  // magma, and (in a tall world) one in each gap between groups of levels. The threshold eases in at a band's edges,
  // so caverns are biggest in its middle. CAVE_T says when each pixel opens in the film: the most open places first.
  const caveTop = (DEEP + 1) * TS + 14,
    BANDS = [...GAPS, { top: caveTop, bot: null }],
    CAVE_START = Math.min(...BANDS.map((b) => b.top)),
    CAVE = new Uint8Array(n),
    CAVE_T = new Float32Array(n);
  for (let y = CAVE_START; y < H; y++)
    for (let x = 0; x < W; x++) {
      const bm = BMI[x];
      if (y >= bm - 2) continue;
      let wb = 0;
      for (const b of BANDS) {
        const bot = b.bot === null ? bm - 3 : b.bot;
        if (y >= b.top && y <= bot) wb = Math.max(wb, smoothstep(b.top, b.top + 16, y) * (1 - smoothstep(bot - 13, bot, y)));
      }
      if (wb <= 0.02) continue;
      const c = fractalNoise(x / 34, y / 13, SEED + 5, 4),
        th = 0.68 - 0.14 * wb;
      if (wb > 0.02 && c > th) {
        CAVE[at(x, y)] = 1;
        CAVE_T[at(x, y)] = clamp(1 - (c - th) / 0.12);
      }
    }
  // stalactites hang from the caverns' ceilings and stalagmites rise from their floors: tapering capsules of rock
  const isCave = (x, y) => x >= 0 && y >= 0 && x < W && y < H && CAVE[at(x, y)] === 1;
  const rockDisc = (cx, cy, r) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.3 && isCave(x, y)) CAVE[at(x, y)] = 0;
  };
  for (const s of scatterAlong(0, W - 1, 7, SEED + 12, { chance: 0.55 })) {
    const x = Math.round(s.x);
    if (x < 1 || x >= W - 1) continue;
    // every ceiling and floor down the column, each cavern band its own
    for (let y = CAVE_START; y < H - 1; y++)
      if (isCave(x, y) && !isCave(x, y - 1)) {
        capsuleSteps(x, y - 1, 1.6, x + (s.variant - 1.5) * 0.4, y + 2 + s.size * 5, 0.3, rockDisc);
        y += 24;
      }
    for (let y = H - 2; y > CAVE_START; y--)
      if (isCave(x, y) && !isCave(x, y + 1)) {
        if (s.variant < 2) capsuleSteps(x, y + 1, 1.9, x, y - 1 - s.size * 3.5, 0.4, rockDisc);
        y -= 24;
      }
  }
  // Each separate cavern (everything a step can reach from one open pixel, floodFill) holds water in its lowest part.
  const WATER = new Uint8Array(n),
    WATER_T = new Float32Array(n),
    REG = new Int32Array(n).fill(-1),
    LAKES = [];
  for (let i = 0; i < n; i++) {
    if (!CAVE[i] || REG[i] >= 0) continue;
    const id = LAKES.length,
      cells = floodFill(
        i,
        (j) => j,
        (j) => {
          const x = j % W,
            y = (j / W) | 0,
            out = [];
          if (isCave(x + 1, y)) out.push(j + 1);
          if (isCave(x - 1, y)) out.push(j - 1);
          if (isCave(x, y + 1)) out.push(j + W);
          if (isCave(x, y - 1)) out.push(j - W);
          return out;
        },
      );
    let top = H,
      bottom = 0,
      cx = 0;
    for (const j of cells) {
      REG[j] = id;
      const y = (j / W) | 0;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      cx += j % W;
    }
    const lake = { id, top, bottom, size: cells.size, cx: cx / cells.size, level: H };
    if (cells.size > 70) {
      lake.level = Math.round(Math.min(bottom - 3, bottom - (bottom - top) * rng.range(0.25, 0.45)));
      for (const j of cells) {
        const y = (j / W) | 0;
        if (y >= lake.level) {
          WATER[j] = 1;
          WATER_T[j] = 1 - (y - lake.level) / Math.max(1, bottom - lake.level);
        }
      }
    }
    LAKES.push(lake);
  }
  // how far each water pixel is from the edge of its water (in thirds of a pixel): foam along the edges, darker deep
  const D_WATER = chamferDistance(
    Uint8Array.from(WATER, (w) => w),
    W,
    H,
  );
  // Fungus grows along the caverns' walls and floors, outward from a few spores, a pixel at a time, each pixel taking
  // or not by its own fixed chance, until it stops spreading (untilSettled). It glows.
  const FUNGUS = new Uint8Array(n);
  const wallside = (x, y) => isCave(x, y) && !WATER[at(x, y)] && (!isCave(x + 1, y) || !isCave(x - 1, y) || !isCave(x, y + 1) || !isCave(x, y - 1));
  for (let y = CAVE_START; y < H; y++)
    for (let x = 1; x < W - 1; x++) if (wallside(x, y) && latticeRandom(x, y, SEED + 7) < 0.007) FUNGUS[at(x, y)] = 1;
  untilSettled(() => {
    let grew = false;
    for (let y = CAVE_START; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = at(x, y);
        if (FUNGUS[i] || !wallside(x, y) || latticeRandom(x, y, SEED + 8) > 0.8) continue;
        if (FUNGUS[i - 1] || FUNGUS[i + 1] || FUNGUS[i - W] || FUNGUS[i + W] || FUNGUS[i - W - 1] || FUNGUS[i - W + 1] || FUNGUS[i + W - 1] || FUNGUS[i + W + 1]) {
          FUNGUS[i] = 1;
          grew = true;
        }
      }
    return grew;
  });

  // ---------------------------------------------------------------------------------------------------- the plan
  // KIND of each tile: 0 rock, 1 the stair shaft, 2 corridor, 3 room, 4 mine tunnel, 5 the well. ROOMOF: which room.
  const GN = GW * GH,
    ti = (x, y) => y * GW + x,
    KIND = new Uint8Array(GN),
    ROOMOF = new Int16Array(GN).fill(-1),
    ROOMS = [],
    SPANS = [], // every corridor and room stretch: where torches can hang
    ENDS = []; // the far end of each side of each level, where a tunnel may start
  const carveTile = (x, y, kind, room = -1) => {
    if (x < 1 || x >= GW - 1 || y < 0 || y >= GH) return;
    if (KIND[ti(x, y)] === 1 && kind !== 1) return;
    KIND[ti(x, y)] = kind;
    ROOMOF[ti(x, y)] = room;
  };
  // the stair shaft, two tiles wide, from the gate to the deepest floor
  for (let y = GR; y <= DEEP; y++) {
    carveTile(EX, y, 1);
    carveTile(EX + 1, y, 1);
  }
  // Each level: from the shaft outward on both sides, a short corridor, then a room, then a corridor, and so on, until
  // the level has its rooms or reaches the edge. A room's floor is the corridor's floor; it may be taller.
  FLOORS.forEach((f, L) => {
    for (const side of [1, -1]) {
      let x = side > 0 ? EX + 2 : EX - 1;
      const limit = side > 0 ? GW - 3 : 2,
        inside = (c) => (side > 0 ? c <= limit : c >= limit);
      // rooms on out toward the edge; after the first two, each side may stop short, so the levels are ragged
      for (let r = 0; ; r++) {
        if (r >= 2 && rng.chance(0.13)) break;
        const c = rng.int(2, 4);
        if (!inside(x + side * (c - 1))) break;
        const a = Math.min(x, x + side * (c - 1)),
          b = Math.max(x, x + side * (c - 1));
        for (let cx = a; cx <= b; cx++) for (let y = f - 2; y <= f; y++) carveTile(cx, y, 2);
        SPANS.push({ x0: a, x1: b, floor: f, top: f - 2, kind: 'corridor', level: L });
        x += side * c;
        const w = rng.int(6, 14),
          h = rng.int(3, HMAX);
        if (!inside(x + side * (w - 1))) break;
        const id = ROOMS.length,
          x0 = Math.min(x, x + side * (w - 1)),
          x1 = Math.max(x, x + side * (w - 1));
        ROOMS.push({ id, level: L, floor: f, top: f - h + 1, x0, x1, side, type: null, dist: Math.abs(x - EX) });
        for (let cx = x0; cx <= x1; cx++) for (let y = f - h + 1; y <= f; y++) carveTile(cx, y, 3, id);
        SPANS.push({ x0, x1, floor: f, top: f - h + 1, kind: 'room', room: id, level: L });
        x += side * w;
      }
      ENDS.push({ x: x - side, side, f, L, limit });
    }
  });
  // Mine tunnels: two tiles high, on out from the far ends of the deepest level (and of some others), ending in a
  // pocket dug wherever the rock round the end holds ore.
  const tileOre = (tx, ty) => {
    let c = 0;
    for (let y = ty * TS; y < ty * TS + TS; y++) for (let x = tx * TS; x < tx * TS + TS; x++) if (y < H && ORE[at(x, y)]) c++;
    return c;
  };
  const MINES = [];
  for (const e of ENDS) {
    if (e.L !== LAST && !rng.chance(0.45)) continue;
    let x = e.x + e.side,
      len = rng.int(5, 14),
      last = null;
    for (let i = 0; i < len; i++, x += e.side) {
      if (e.side > 0 ? x > e.limit : x < e.limit) break;
      carveTile(x, e.f, 4);
      carveTile(x, e.f - 1, 4);
      last = x;
    }
    if (last === null) continue;
    const ox = last + e.side;
    for (let dy = -2; dy <= 1; dy++)
      for (let dx = -1; dx <= 2; dx++) {
        const tx = ox + dx * e.side,
          ty = e.f - 1 + dy;
        if (ty >= e.f + 1 || tx < 2 || tx > GW - 3) continue;
        if (tileOre(tx, ty) > 1 || rng.chance(dy === 0 ? 0.7 : 0.3)) carveTile(tx, ty, 4);
      }
    MINES.push({ x: last, f: e.f, side: e.side });
  }

  // More stairs, two tiles wide, from the top level to the deepest, so not every dwarf crowds the main shaft: one for
  // every 70 or so tiles of width, each at a column where many levels have a corridor to meet it, well apart from the
  // main shaft and each other. (Corridors score more than rooms: a stair through a corridor blocks nothing.)
  const STAIRS = [];
  {
    const score = [];
    for (let x = 3; x < GW - 5; x++) {
      let c = 0;
      for (const f of FLOORS)
        if (KIND[ti(x, f)] === 2 && KIND[ti(x + 1, f)] === 2) c += 2;
        else if (KIND[ti(x, f)] && KIND[ti(x + 1, f)]) c += 1;
      score.push([c + rng.next() * 0.5, x]);
    }
    score.sort((a, b) => b[0] - a[0]);
    const want = Math.max(1, Math.round(GW / 70));
    for (const [c, x] of score) {
      if (STAIRS.length >= want || c < FLOORS.length) break;
      if (Math.abs(x - EX) < 18 || STAIRS.some((s) => Math.abs(s - x) < 30)) continue;
      STAIRS.push(x);
      for (let y = FLOORS[0] - 2; y <= DEEP; y++) {
        carveTile(x, y, 1);
        carveTile(x + 1, y, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------- room types
  // The widest room on the top level is the great hall and the widest on the deepest is the forge; the rest are drawn
  // from each level's own list, and any room left over is a bedroom.
  const byLevel = FLOORS.map((_, L) => ROOMS.filter((r) => r.level === L));
  const assign = (list, first, pool) => {
    const sorted = [...list].sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0) || a.dist - b.dist);
    if (first && sorted.length) sorted.shift().type = first;
    for (const r of sorted)
      r.type = pool.length ? pool.splice(rng.int(0, pool.length - 1), 1)[0] : rng.pick(['beds', 'beds', 'store', 'farm', 'workshop', 'library', 'temple', 'kitchen']);
  };
  assign(byLevel[0], 'hall', ['kitchen', 'workshop', 'store', 'beds', 'store']);
  const MID = [
    ['beds', 'temple', 'store', 'library', 'beds'],
    ['library', 'farm', 'beds', 'workshop', 'beds'],
    ['beds', 'farm', 'store', 'temple', 'beds'],
  ];
  // every fourth level has a dining hall of its own, so the dwarves of a deep hold need not climb to eat
  // the deeper groups of a tall hold are its workings: forges, vaults and workshops more than bedrooms
  const DEEPER = ['forge', 'store', 'workshop', 'vault', 'beds', 'farm', 'forge', 'beds'];
  for (let L = 1; L < LAST; L++)
    assign(byLevel[L], L % 4 === 0 || GROUP[L] !== GROUP[L - 1] ? 'hall' : 'beds', [...(GROUP[L] > 0 ? DEEPER : MID[(L - 1) % MID.length])]);
  assign(byLevel[LAST], 'forge', ['vault', 'tomb', 'store', 'farm', 'workshop']);
  // every hold needs somewhere to sleep: if it has too few bedrooms, storerooms become bedrooms
  const bedsIn = (r) => Math.max(1, Math.floor(((r.x1 - r.x0 + 1) * TS - 2) / 11));
  let beds = ROOMS.filter((r) => r.type === 'beds').reduce((s, r) => s + bedsIn(r), 0);
  for (const r of ROOMS) if (beds < 5 && (r.type === 'store' || r.type === 'library')) (r.type = 'beds'), (beds += bedsIn(r));

  // ---------------------------------------------------------------------------------------------------- the well
  // A shaft a tile wide from the deepest level down to a lake, if one lies under it: the column whose first open
  // pixel going down is water, nearest the stairs.
  let WELL = null;
  {
    let bestD = 1e9;
    for (let tx = 2; tx < GW - 2; tx++) {
      const k0 = KIND[ti(tx, DEEP)];
      if (k0 !== 2 && k0 !== 3) continue;
      const px = tx * TS + 2;
      for (let y = (DEEP + 1) * TS; y < H - 4; y++) {
        if (MAT[at(px, y)] === 5) break;
        if (!CAVE[at(px, y)]) continue;
        let wet = -1;
        for (let yy = y; yy < Math.min(H, y + 10); yy++) if (WATER[at(px, yy)]) (wet = yy), (yy = H);
        if (wet >= 0 && Math.abs(tx - EX) < bestD) {
          bestD = Math.abs(tx - EX);
          WELL = { x: tx, f: DEEP, top: (DEEP + 1) * TS, water: wet, cave: y };
        }
        break;
      }
    }
    if (WELL) for (let y = WELL.f + 1; y * TS < WELL.cave; y++) carveTile(WELL.x, y, 5);
  }

  // ---------------------------------------------------------------------------------------------------- dug, and when
  // The order of digging: outward from the gate a ring at a time, each ring the tiles next to the last, until no tile
  // of the plan is left (untilSettled). DIGD is a tile's ring; the film digs it at that share of the dig.
  const DIGD = new Int16Array(GN).fill(-1);
  let ring = [ti(EX, GR), ti(EX + 1, GR)],
    d = 0;
  for (const t of ring) DIGD[t] = 0;
  untilSettled(() => {
    const next = [];
    d++;
    for (const t of ring) {
      const x = t % GW,
        y = (t / GW) | 0;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ])
        if (nx >= 0 && ny >= 0 && nx < GW && ny < GH && KIND[ti(nx, ny)] && DIGD[ti(nx, ny)] < 0) {
          DIGD[ti(nx, ny)] = d;
          next.push(ti(nx, ny));
        }
    }
    ring = next;
    return next.length > 0;
  });
  let MAXD = 1;
  for (let t = 0; t < GN; t++) if (DIGD[t] > MAXD) MAXD = DIGD[t];
  for (let t = 0; t < GN; t++) if (KIND[t] && DIGD[t] < 0) DIGD[t] = MAXD;
  const dug = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && KIND[ti(x, y)] > 0;
  // which pixels are open once everything is dug: the dug tiles, the caverns and the air
  const OPEN = new Uint8Array(n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) OPEN[at(x, y)] = MAT[at(x, y)] === 0 || CAVE[at(x, y)] || dug(x >> 2, y >> 2) ? 1 : 0;

  // ---------------------------------------------------------------------------------------------------- footing
  // A dwarf can stand on a tile that is dug and has rock (or the well's cover) under it, and anywhere on the stairs.
  const FREE = new Uint8Array(GN);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const kd = KIND[ti(x, y)];
      if (!kd || kd === 5) continue;
      const below = y + 1 < GH ? KIND[ti(x, y + 1)] : 0;
      FREE[ti(x, y)] = kd === 1 || !below || below === 5 ? 1 : 0;
    }
  const free = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && FREE[ti(x, y)] === 1;
  // where a thing (or a dwarf's feet) stands on floor f: the row just above the floor strip
  const SY = (f) => (f + 1) * TS - 2;

  // ---------------------------------------------------------------------------------------------------- furnishing
  // What stands in each room, by its type, left to right from a margin. Each item has a kind (a sprite), a place, which
  // way it faces, and when it appears (rooms nearer the stairs first).
  const ITEMS = [];
  const put = (room, kind, x, o = {}) =>
    ITEMS.push({ kind, x: Math.round(x), y: o.y === undefined ? SY(room.floor) : o.y, room: room.id, flip: !!o.flip, v: o.v === undefined ? rng.int(0, 9) : o.v, wall: !!o.wall, appear: 0 });
  const BEDS = [],
    SEATS = [],
    SPOTS = {}; // where each kind of work is done: { forge: [[tx, ty], ...], ... }
  const spot = (type, x, f) => (SPOTS[type] = SPOTS[type] || []).push([Math.floor(x / TS), f]);
  for (const r of ROOMS) {
    const a = r.x0 * TS + 2,
      b = (r.x1 + 1) * TS - 3,
      w = b - a,
      far = r.side > 0 ? b : a, // the end away from the stairs
      near = r.side > 0 ? a : b,
      dir = r.side, // toward the far end
      topY = r.top * TS + 1;
    if (r.type === 'hall') {
      const tables = Math.max(1, Math.floor((w - 8) / 16));
      for (let i = 0; i < tables; i++) {
        const x = a + 8 + (i + 0.5) * ((w - 8) / tables);
        put(r, 'table', x);
        put(r, 'chair', x - 6);
        put(r, 'chair', x + 6, { flip: true });
        SEATS.push([Math.floor((x - 6) / TS), r.floor], [Math.floor((x + 6) / TS), r.floor]);
      }
      put(r, 'throne', far - dir * 3, { flip: dir > 0 });
      for (let x = a + 6; x < b - 4; x += 15) put(r, 'banner', x, { y: topY + 1, wall: true });
      spot('hall', far - dir * 8, r.floor);
    } else if (r.type === 'kitchen') {
      put(r, 'oven', far - dir * 5);
      put(r, 'still', far - dir * 14);
      for (let x = near + dir * 3, i = 0; i < 3 && Math.abs(x - near) < w - 20; x += dir * 6, i++) put(r, 'barrel', x);
      spot('kitchen', far - dir * 9, r.floor);
    } else if (r.type === 'beds') {
      const nb = bedsIn(r),
        slot = w / nb;
      for (let i = 0; i < nb; i++) {
        const x = a + slot * i + Math.min(5, slot / 2);
        put(r, 'bed', x, { flip: false });
        if (slot >= 13) put(r, 'chest', x + 8);
        BEDS.push({ x: Math.round(x), f: r.floor, tx: Math.floor(x / TS), room: r.id });
      }
    } else if (r.type === 'store') {
      for (let x = a + 3; x < b - 2; x += 6) {
        const kind = rng.chance(0.5) ? 'barrel' : 'crate';
        put(r, kind, x);
        if (rng.chance(0.45)) put(r, rng.chance(0.5) ? 'barrel' : 'crate', x, { y: SY(r.floor) - 6 });
      }
      spot('store', (a + b) / 2, r.floor);
    } else if (r.type === 'workshop') {
      put(r, 'bench', far - dir * 7);
      put(r, 'blocks', near + dir * 6);
      if (w > 30) put(r, 'blocks', near + dir * 14);
      spot('workshop', far - dir * 13, r.floor);
    } else if (r.type === 'forge') {
      put(r, 'furnace', far - dir * 5);
      put(r, 'anvil', far - dir * 15);
      for (let x = near + dir * 4, i = 0; i < 2; x += dir * 7, i++) put(r, 'crate', x);
      spot('forge', far - dir * 19, r.floor);
    } else if (r.type === 'farm') {
      for (let x = a + 2; x <= b - 1; x += 3) put(r, 'mushroom', x, { v: rng.int(0, 2) });
      spot('farm', (a + b) / 2, r.floor);
    } else if (r.type === 'temple') {
      const mid = (a + b) / 2;
      put(r, 'altar', mid);
      put(r, 'statue', a + 3);
      put(r, 'statue', b - 3, { flip: true });
      spot('temple', mid - dir * 8, r.floor);
    } else if (r.type === 'library') {
      for (let x = a + 4; x < b - 3; x += 9) put(r, 'shelf', x);
      spot('library', (a + b) / 2, r.floor);
    } else if (r.type === 'vault') {
      for (let x = a + 5, i = 0; x < b - 3; x += 10, i++) put(r, i % 2 ? 'chest' : 'gold', x);
      spot('vault', (a + b) / 2, r.floor);
    } else if (r.type === 'tomb') {
      for (let x = a + 6; x < b - 4; x += 11) put(r, 'coffin', x);
      spot('tomb', (a + b) / 2, r.floor);
    }
  }
  // nothing stands on the stairs where they pass through a room
  for (const S2 of STAIRS) {
    const clear = (x) => x < S2 * TS - 5 || x > (S2 + 2) * TS + 4;
    for (const list of [ITEMS, BEDS]) {
      const kept = list.filter((it) => clear(it.x));
      list.length = 0;
      list.push(...kept);
    }
    const kept = SEATS.filter(([tx]) => tx < S2 - 1 || tx > S2 + 2);
    SEATS.length = 0;
    SEATS.push(...kept);
  }
  if (WELL) ITEMS.push({ kind: 'winch', x: WELL.x * TS + 2, y: SY(WELL.f), room: -1, flip: false, v: 0, wall: false, appear: 0 });
  // things appear room by room, from the stairs outward and downward
  for (const it of ITEMS) {
    const tx = Math.floor(it.x / TS),
      ty = Math.floor((it.y - 1) / TS);
    it.appear = clamp(0.05 + 0.8 * ((DIGD[ti(tx, Math.min(GH - 1, ty))] || 0) / MAXD) + rng.range(-0.04, 0.04));
  }
  ITEMS.sort((p, q) => (p.wall === q.wall ? 0 : p.wall ? -1 : 1));

  // ---------------------------------------------------------------------------------------------------- lights
  // Torches on the back walls (scattered along each stretch, and at least one in every room), on alternate sides down
  // the shaft, and the fires of the furnace and the oven and the altar's candles. Each lights a circle round it,
  // softly, but only where nothing stands between (segmentClear through open pixels), so a torch does not light the
  // rooms through the rock above or below it.
  const LIGHTS = [];
  const light = (x, y, r, s, kind) => LIGHTS.push({ x, y, r, s, kind, id: LIGHTS.length, appear: 0 });
  SPANS.forEach((sp, j) => {
    const xs = scatterAlong(sp.x0 * TS + 3, (sp.x1 + 1) * TS - 4, sp.kind === 'room' ? 22 : 18, SEED + j * 7, { chance: 0.72 })
      .map((s) => Math.round(s.x))
      .filter((x) => x >= sp.x0 * TS + 2 && x <= (sp.x1 + 1) * TS - 3);
    if (sp.kind === 'room' && !xs.length) xs.push(Math.round(((sp.x0 + sp.x1 + 1) * TS) / 2));
    for (const x of xs) light(x, SY(sp.floor) - 7, 22, 0.95, 'torch');
  });
  for (let y = GR + 3, s = 0; y < DEEP - 1; y += 4, s++) light(EX * TS + (s & 1 ? 7 : 1), y * TS + 2, 18, 0.8, 'torch');
  for (const S2 of STAIRS)
    for (let y = FLOORS[0] + 1, s = 0; y < DEEP - 1; y += 4, s++) light(S2 * TS + (s & 1 ? 7 : 1), y * TS + 2, 18, 0.8, 'torch');
  for (const m of MINES) light(m.x * TS + 2, SY(m.f) - 6, 18, 0.85, 'torch'); // a lantern at each mine's face
  for (const it of ITEMS) {
    if (it.kind === 'furnace') light(it.x, it.y - 3, 30, 1.25, 'fire');
    if (it.kind === 'oven') light(it.x, it.y - 2, 20, 0.9, 'fire');
    if (it.kind === 'altar') light(it.x, it.y - 6, 14, 0.7, 'candle');
  }
  for (const L of LIGHTS) {
    const tx = clamp(Math.floor(L.x / TS), 0, GW - 1),
      ty = clamp(Math.floor(L.y / TS), 0, GH - 1);
    L.appear = L.kind === 'torch' ? clamp(0.08 + 0.75 * ((DIGD[ti(tx, ty)] || 0) / MAXD) + rng.range(-0.05, 0.05)) : 0;
  }
  const openAt = (x, y) => {
    const xi = Math.round(x),
      yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < W && yi < H && OPEN[at(xi, yi)] === 1;
  };
  // TORCH: how much light reaches each pixel; LID: the light that gives it most (whose flicker it follows)
  const TORCH = new Float32Array(n),
    LID = new Int16Array(n).fill(-1),
    LBEST = new Float32Array(n);
  for (const L of LIGHTS)
    for (let y = Math.max(0, Math.floor(L.y - L.r)); y <= Math.min(H - 1, Math.ceil(L.y + L.r)); y++)
      for (let x = Math.max(0, Math.floor(L.x - L.r)); x <= Math.min(W - 1, Math.ceil(L.x + L.r)); x++) {
        const dd = Math.hypot(x - L.x, y - L.y);
        if (dd > L.r || !segmentClear(L.x, L.y, x, y, 1, openAt)) continue;
        const c = L.s * Math.pow(1 - dd / L.r, 1.5),
          i = at(x, y);
        TORCH[i] += c;
        if (c > LBEST[i]) {
          LBEST[i] = c;
          LID[i] = L.id;
        }
      }
  // the magma's glow, reaching up into the caverns over it
  const MAGL = new Float32Array(n);
  for (let x = 0; x < W; x++)
    for (let y = BMI[x] - 1; y >= Math.max(0, BMI[x] - 40); y--) {
      const i = at(x, y),
        u = (BMI[x] - y) / 40;
      if (OPEN[i] || OPEN[i + 1] || OPEN[i - 1] || OPEN[i + W]) MAGL[i] = 0.75 * Math.pow(1 - u, 1.6);
    }
  // and the fungus's own faint glow on the cavern round it
  for (let i = 0; i < n; i++) {
    if (!FUNGUS[i]) continue;
    const fx = i % W,
      fy = (i / W) | 0;
    for (let y = Math.max(0, fy - 6); y <= Math.min(H - 1, fy + 6); y++)
      for (let x = Math.max(0, fx - 6); x <= Math.min(W - 1, fx + 6); x++) {
        const dd = Math.hypot(x - fx, y - fy);
        if (dd < 6 && CAVE[at(x, y)]) MAGL[at(x, y)] = Math.min(1, MAGL[at(x, y)] + 0.05 * (1 - dd / 6));
      }
  }
  // how far each pixel of rock is from open space (pixels): deep rock is darker
  const D_ROCK = chamferDistance(
    Uint8Array.from(OPEN, (o) => (o ? 0 : 1)),
    W,
    H,
  );

  // ---------------------------------------------------------------------------------------------------- work
  // Where the miners stand: the floor at the end of each tunnel, nudged to the nearest tile a dwarf can stand on.
  for (const m of MINES) {
    const c = nearestFreeCell(m.x, m.f, free, 3);
    if (c) (SPOTS.mine = SPOTS.mine || []).push(c);
  }
  for (const key of Object.keys(SPOTS))
    SPOTS[key] = SPOTS[key].map(([x, y]) => nearestFreeCell(clamp(x, 0, GW - 1), y, free, 4)).filter(Boolean);

  // prettier-ignore
  return { at, ti, n, GN, SURF, SURFI, EX, GR, EY, GATE_X, hillX, FLOORS, DEEP, SP, MAT, BMI, ORE, CAVE, CAVE_T,
    WATER, WATER_T, D_WATER, FUNGUS, LAKES, caveTop, KIND, ROOMOF, ROOMS, SPANS, MINES, WELL, DIGD, MAXD, OPEN,
    FREE, free, SY, ITEMS, BEDS, SEATS, SPOTS, LIGHTS, TORCH, LID, MAGL, D_ROCK, dug };
}
