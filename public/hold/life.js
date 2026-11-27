// What moves in the hold, a step at a time: the dwarves (each with a job, a bed and a way of walking), the bats in the
// caverns, drips from the caverns' ceilings, embers from the fires and the magma, the sleepers' z's, and fireflies
// over the grass at night.
//
// Everything that changes is kept in sim, so the scene can wipe it and start again from the first frame when the
// timeline is dragged back.

/**
 * The dwarves, and a stepper for everything alive.
 *
 * How it works: each dwarf's genes are drawn from the dwarves' ranges (genomeFrom), and the youngest is the child of
 * the first two (crossGenomes). Jobs go to the rooms the hold has: miners to the tunnels, a
 * smith to the forge, a cook to the kitchen, and so on; anyone left over is a hauler. Every step, a dwarf with nowhere
 * to go picks somewhere (its work, a seat in the hall, somewhere else in the hold, or its bed at night), finds the
 * shortest way there over the tiles it can stand on (gridAStar), and walks it.
 */
export function makeLife(k, look, world) {
  const { A, W, H, TS, GW, GH, FPS, SEED, T } = k;
  // prettier-ignore
  const { SeededRandom, clamp, crossGenomes, fall, flockStep, genomeFrom, gridAStar, hover, particleField, pulseRise,
    rise, scatterAlong, strideRate, wrapAround } = A;
  // prettier-ignore
  const { at, ti, free, SY, BEDS, SEATS, SPOTS, EX, GR, ITEMS, LAKES, CAVE, WATER, MAT, SURF, SURFI, BMI, ROOMS, KIND,
    ROOMOF, FREE, DIGD, GATE_X, hillX, GN } = world;
  const make = new SeededRandom(SEED + 100);

  // the dwarves' kind: each gene a range, a list or a chance
  const GENES = {
    beard: ['#b8452a', '#d89a3a', '#6a4026', '#2c2422', '#cfc6b4', '#8a3a20', '#e0c070'],
    long: { chance: 0.6 },
    skin: ['#f2c9a0', '#e2aa80', '#c88c60', '#9c6a46'],
    tunic: ['#a83a32', '#3a64a8', '#4a8a40', '#b8862a', '#6a4a9a', '#2a7a7a', '#8a5a3a'],
    trousers: ['#5a4632', '#3a3a4a', '#4a3a2a'],
    hat: ['hair', 'hood', 'helmet', 'cap', 'hair'],
    hatC: ['#7a2a2a', '#2a4a7a', '#3a6a3a', '#8a6a2a'],
    speed: [0.85, 1.15],
  };
  const count = clamp(BEDS.length, 4, k.maxDwarves),
    DWARVES = [];
  for (let i = 0; i < count; i++) DWARVES.push({ id: i, g: genomeFrom(GENES, make), bed: BEDS[i] || null, job: 'hall' });
  // the youngest one or two are children of the first couples
  DWARVES[count - 1].g = { ...crossGenomes(DWARVES[0].g, DWARVES[1].g, GENES, make), child: true };
  if (count >= 12) DWARVES[count - 2].g = { ...crossGenomes(DWARVES[2].g, DWARVES[3].g, GENES, make), child: true };
  // Jobs, round and round this list, each job taking as many dwarves as the hold has places for it (a forge, a
  // kitchen, a mine face each); anyone left over hauls and wanders.
  const ORDER = ['mine', 'forge', 'kitchen', 'farm', 'workshop', 'temple', 'library', 'vault', 'tomb', 'store'],
    taken = {};
  let next = 0;
  for (let grew = true; grew && next < count; ) {
    grew = false;
    for (const job of ORDER) {
      while (next < count && DWARVES[next].g.child) next++;
      if (next >= count) break;
      if ((taken[job] || 0) < (SPOTS[job] ? SPOTS[job].length : 0)) {
        DWARVES[next++].job = job;
        taken[job] = (taken[job] || 0) + 1;
        grew = true;
      }
    }
  }
  // how far a step's phase turns for each pixel walked, so the feet do not slide
  const RATE = strideRate(1.2);
  const PLACES = Object.values(SPOTS).flat();
  // Each worker has one workplace of its own (the forges, kitchens and mine faces shared out in turn), so in a big hold
  // a dwarf keeps to its own part of it. Beds are not owned: at dusk each dwarf takes the nearest bed nobody has.
  const seen = {};
  for (const d of DWARVES) {
    const list = SPOTS[d.job];
    if (list && list.length) d.home = list[(seen[d.job] = (seen[d.job] || 0) + 1) % list.length];
  }

  // ---------------------------------------------------------------------------------------------------- the dig
  // The hold is dug by the dwarves themselves. Every tile of the plan starts as rock; a dwarf picks a stretch of the
  // dig's frontier (planned tiles next to dug ones) near it, walks to a tile it can stand on beside it, and digs it out
  // with a pick, a column of rock at a time. PLANNED: how many tiles the plan has; TILE_S: seconds to dig one. At most
  // CREW of them dig at once, so a small hold takes several minutes and a page-deep one twenty minutes or so.
  let PLANNED = 0;
  for (let t = 0; t < GN; t++) if (KIND[t]) PLANNED++;
  // Seconds a tile: in a small hold a corridor's column takes about two seconds, a pick going steadily; a
  // bigger hold has more to dig through the same few rock faces at a time, so its dwarves dig faster (down to about
  // half that). CREW: how many dwarves come in to dig it; the rest of the hold's people arrive once it is dug. DIG_S: about how
  // long it should take; DIG_CAP: seconds into the dig by which, if they have not finished, the rest is dug at once.
  const TILE_S = clamp(0.567 * Math.sqrt(4000 / PLANNED), 0.28, 0.567),
    CREW = 7,
    DIG_S = clamp(PLANNED / 220, 15, 60),
    DIG_CAP = DIG_S * 120 + 60,
    TOP = [ti(EX, GR), ti(EX + 1, GR)], // the two tiles at the top of the stairs, under the gate
    ROOM_TILES = new Int32Array(ROOMS.length);
  for (let t = 0; t < GN; t++) if (ROOMOF[t] >= 0) ROOM_TILES[ROOMOF[t]]++;
  // Arrivals: the dwarves walk in over the grass from the edge away from the hill, one after another: the first CREW
  // to dig, the first reaching the gate as the dig begins; the rest once the hold is dug (until then, never).
  const FROM = hillX > W / 2 ? -10 : W + 10,
    WALK = 60, // pixels a second over the grass
    GAP = clamp(26 / Math.min(count, CREW), 0.25, 0.9), // seconds between one dwarf setting off and the next
    LATE_GAP = clamp(40 / count, 0.3, 0.9); // and between the latecomers, once the dig is done
  const arriveAt = (i) =>
    i < CREW ? T.embark[0] + 0.2 + i * GAP : sim.digEnd === undefined ? Infinity : sim.digEnd + 0.5 + (i - CREW) * LATE_GAP;
  // where a dwarf can stand while the dig goes on: a tile it could stand on in the finished hold, already dug
  const freeNow = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && FREE[ti(x, y)] === 1 && sim.dug[ti(x, y)] === 1;

  /**
   * The rock a dwarf digs out in one go, for a tile of the frontier: on the stairs, the row across both columns; in a
   * corridor or room, the whole column of it from floor to ceiling; the well all at once; in a mine, the tunnel and the
   * ore pocket round it (everything of the mine within two tiles).
   */
  function chunkOf(t0) {
    const x = t0 % GW,
      y = (t0 / GW) | 0,
      kd = KIND[t0],
      out = [],
      open = (t) => KIND[t] && !sim.dug[t] && !sim.taken.has(t);
    if (kd === 1) {
      // the stairs: across both columns, and down four rows at a time (every level below waits on them)
      for (let yy = y; yy < Math.min(GH, y + 4); yy++) {
        if (KIND[ti(x, yy)] !== 1) break;
        for (const nx of [x - 1, x, x + 1]) if (nx >= 0 && nx < GW && KIND[ti(nx, yy)] === 1 && open(ti(nx, yy))) out.push(ti(nx, yy));
      }
    } else if (kd === 5) {
      for (let yy = y; yy < GH && KIND[ti(x, yy)] === 5; yy++) if (open(ti(x, yy))) out.push(ti(x, yy));
    } else if (kd === 4) {
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < GW && yy < GH && KIND[ti(xx, yy)] === 4 && open(ti(xx, yy))) out.push(ti(xx, yy));
        }
    } else {
      const same = (t) => KIND[t] >= 2 && KIND[t] <= 4 && open(t);
      let y0 = y,
        y1 = y;
      while (y0 > 0 && same(ti(x, y0 - 1))) y0--;
      while (y1 < GH - 1 && same(ti(x, y1 + 1))) y1++;
      for (let yy = y0; yy <= y1; yy++) out.push(ti(x, yy));
    }
    return out;
  }
  // the breadth-first search's own arrays, kept between searches: which search last reached each tile, and from where
  const SEEN = new Uint32Array(GN),
    PREV = new Int32Array(GN),
    DEPTH = new Int32Array(GN),
    QUEUE = new Int32Array(GN),
    STAIR_PULL = 10,
    CLAIM_STEPS = 24; // the furthest (in steps) a dwarf will claim rock from: further than that, it walks closer first
  let stamp = 0;
  /**
   * The next piece of digging for a dwarf: the nearest rock it can reach. A breadth-first search goes out from where
   * it stands over the tiles it can stand on now (eight ways, never cutting a corner past rock, as gridAStar walks), a
   * step at a time, and stops at the first tile that has untaken frontier rock beside it; the way there is read back
   * from where each tile was reached from. One search finds both the nearest face and the path to it.
   */
  function chooseDig(w) {
    const start = ti(w.tx, w.ty);
    stamp++;
    SEEN[start] = stamp;
    PREV[start] = -1;
    DEPTH[start] = 0;
    let head = 0,
      tail = 0,
      best = null,
      bestScore = Infinity;
    QUEUE[tail++] = start;
    while (head < tail && head < 8000) {
      const n = QUEUE[head++],
        x = n % GW,
        y = (n / GW) | 0;
      // Nearest first, but the stairs count as STAIR_PULL steps nearer than they are: every level below waits on
      // them, so whoever is digging them carries on down rather than turning off along a corridor. The search goes on
      // only as far as something could still beat the best found.
      if (DEPTH[n] - STAIR_PULL > bestScore) break;
      // frontier rock beside this tile? (straight neighbours first, so a dwarf digs in front of it rather than above)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, -1],
        [-1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const m = ti(x + dx, y + dy);
        if (x + dx < 0 || x + dx >= GW || y + dy < 0 || y + dy >= GH || !sim.frontier.has(m) || sim.taken.has(m)) continue;
        const score = DEPTH[n] - (KIND[m] === 1 ? STAIR_PULL : 0);
        if (score < bestScore) (bestScore = score), (best = [n, m]);
      }
      // on outward
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx,
            ny = y + dy;
          if (!freeNow(nx, ny) || (dx && dy && (!freeNow(x + dx, y) || !freeNow(x, y + dy)))) continue;
          const m = ti(nx, ny);
          if (SEEN[m] === stamp) continue;
          SEEN[m] = stamp;
          PREV[m] = n;
          DEPTH[m] = DEPTH[n] + 1;
          QUEUE[tail++] = m;
        }
    }
    if (!best) return null;
    const chunk = chunkOf(best[1]);
    if (!chunk.length) return null;
    const path = [];
    for (let p = best[0]; p >= 0; p = PREV[p]) path.push([p % GW, (p / GW) | 0]);
    return { chunk, path: path.reverse() };
  }
  /** Rock dug out at second t: the tiles marked dug, the frontier moved on, any room finished noted. */
  function finishDig(tiles, t) {
    for (const tl of tiles) {
      sim.taken.delete(tl);
      if (sim.dug[tl]) continue;
      sim.dug[tl] = 1;
      sim.digAt[tl] = t;
      sim.frontier.delete(tl);
      const r = ROOMOF[tl];
      if (r >= 0 && --sim.roomLeft[r] === 0) sim.roomDone[r] = t;
      const x = tl % GW,
        y = (tl / GW) | 0;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ])
        if (nx >= 0 && ny >= 0 && nx < GW && ny < GH && KIND[ti(nx, ny)] && !sim.dug[ti(nx, ny)]) sim.frontier.add(ti(nx, ny));
    }
    if (!sim.frontier.size && sim.digEnd === undefined) sim.digEnd = t;
  }
  /** If the dwarves have not finished in good time (a corner they cannot reach), the rest is dug at once. */
  function finishAll(t) {
    const rest = [];
    for (let tl = 0; tl < GN; tl++) if (KIND[tl] && !sim.dug[tl]) rest.push(tl);
    finishDig(rest, t);
    sim.digEnd = t;
  }
  /** When a thing in the rooms appears: soon after its room is dug out (a few at a time, not all at once). */
  function itemAt(it) {
    if (!sim.roomDone) return Infinity;
    const base = it.room >= 0 ? sim.roomDone[it.room] : sim.digAt[ti(Math.floor(it.x / TS), Math.floor((it.y + 2) / TS))];
    return base + 0.3 + (((it.x * 13 + it.y * 7) % 10) * 0.06);
  }

  const sim = { f: -1 };
  /** Sets up what lives in the hold the first time it is stepped (and again after the timeline is wiped). */
  function init() {
    sim.rng = new SeededRandom(SEED + 200);
    sim.drng = new SeededRandom(SEED + 300); // the dwarves' own choices, apart from the particles'
    sim.ready = true;
    sim.claimed = new Set(); // the beds taken tonight
    // the dig: what is dug and when, the frontier, the rock someone is already digging, and the rooms still to finish
    sim.dug = new Uint8Array(GN);
    sim.digAt = new Float32Array(GN).fill(Infinity);
    sim.frontier = new Set(TOP);
    sim.taken = new Set();
    sim.roomLeft = Int32Array.from(ROOM_TILES);
    sim.roomDone = new Float32Array(ROOMS.length).fill(Infinity);
    // drips: from the ceilings over each lake's water
    sim.drips = [];
    for (const lake of LAKES) {
      if (lake.level >= H) continue;
      for (const s of scatterAlong(0, W - 1, 11, SEED + lake.id * 13, { chance: 0.5 })) {
        const x = Math.round(s.x);
        if (x < 0 || x >= W || !WATER[at(x, Math.min(H - 1, lake.level + 1))]) continue;
        let y = lake.level;
        while (y > 0 && CAVE[at(x, y - 1)]) y--;
        if (lake.level - y > 4) sim.drips.push({ sx: x, sy: y, x, y, z: 1, p: 0, s: s.size, wait: sim.rng.range(0, 2), splash: 0 });
      }
    }
    // embers: from the furnace, the oven and the magma's crust where a cavern is over it
    sim.embers = [];
    const sources = [];
    for (const it of ITEMS) if (it.kind === 'furnace' || it.kind === 'oven') sources.push({ x: it.x + (it.kind === 'furnace' ? 2 : 0), y: it.y - (it.kind === 'furnace' ? 9 : 3), item: it });
    for (const s of scatterAlong(0, W - 1, 24, SEED + 61, { chance: 0.8 })) {
      const x = Math.round(s.x);
      if (x >= 0 && x < W && CAVE[at(x, BMI[x] - 2)]) sources.push({ x, y: BMI[x] - 1, magma: true });
    }
    for (const src of sources)
      for (let j = 0; j < (src.magma ? 2 : 3); j++)
        sim.embers.push({ src, x: src.x, y: src.y, z: 1, p: sim.rng.range(0, 6.3), s: sim.rng.next(), life: sim.rng.range(0, 1.2) });
    sim.zs = [];
    // fireflies: over the grass, drifting slowly along it
    sim.flies = particleField(16, W, 1, sim.rng).map((q) => ({ ...q, y: 0, h: sim.rng.range(3, 14) }));
  }

  /** The bats: a little flock in the biggest cavern, kept in it by a band of heights and a pull back to its middle. */
  function initBats() {
    const big = LAKES.reduce((b, l) => (!b || l.size > b.size ? l : b), null);
    sim.bats = [];
    if (!big || big.size < 300) return;
    sim.batCave = big;
    for (let j = 0; j < 7; j++)
      sim.bats.push({
        x: big.cx + sim.rng.range(-12, 12),
        y: big.top + (Math.min(big.level, big.bottom) - big.top) * 0.35 + sim.rng.range(-3, 3),
        vx: sim.rng.range(-10, 10),
        vy: sim.rng.range(-4, 4),
        seed: j * 1.7,
        speed: sim.rng.range(0.85, 1.15),
      });
  }

  /** The dwarves, at the start of the arrival: all still off the edge of the picture, each with its moment to set off. */
  function initDwarves() {
    sim.dw = DWARVES.map((d, i) => ({
      d,
      mode: 'arrive', // then 'dig' once through the gate, then 'live' once the hold is dug
      at: arriveAt(i),
      tx: EX,
      ty: GR,
      x: FROM,
      y: SURFI[Math.max(0, Math.min(W - 1, Math.round(FROM)))] - 1,
      dir: FROM < GATE_X ? 1 : -1,
      phase: 0,
      moving: false,
      wait: 0,
      hidden: true,
      path: null,
      working: false,
      digging: false,
      sleeping: false,
      goal: null,
    }));
  }
  const pick = (list) => list[Math.floor(sim.drng.next() * list.length)];
  // of a few places picked at random, the nearest (a level up or down counting as far as a long walk along one), so a
  // dwarf in a big hold mostly keeps to its own part of it
  const pickNear = (list, w, tries = 3) => {
    let best = null,
      bd = 1e9;
    for (let j = 0; j < tries; j++) {
      const p = pick(list),
        dd = Math.abs(p[0] - w.tx) + 4 * Math.abs(p[1] - w.ty);
      if (dd < bd) (bd = dd), (best = p);
    }
    return best;
  };
  /**
   * Somewhere for a dwarf to go next: its bed at night (or a seat in the hall if it has no bed), otherwise its work,
   * then a meal or a wander, then its work again.
   */
  function goalFor(w, night) {
    if (night) {
      // the nearest bed no one has claimed (a level up or down counting as a long walk), or a hall bench
      let best = null,
        bd = 1e9;
      for (const b of BEDS) {
        if (sim.claimed.has(b)) continue;
        const dd = Math.abs(b.tx - w.tx) + 4 * Math.abs(b.f - w.ty);
        if (dd < bd) (bd = dd), (best = b);
      }
      if (best) {
        sim.claimed.add(best);
        w.bed = best;
        return { at: [best.tx, best.f], kind: 'bed' };
      }
      return { at: pickNear(SEATS.length ? SEATS : PLACES, w), kind: 'bed' };
    }
    if (!w.lastWork && w.d.home) return { at: w.d.home, kind: 'work' };
    const r = sim.drng.next();
    if (r < 0.45 && SEATS.length) return { at: pickNear(SEATS, w), kind: 'eat' };
    return { at: pickNear(PLACES.length ? PLACES : [[EX, GR]], w), kind: 'wander' };
  }
  /**
   * Walks a dwarf along its path at a speed (pixels a second); true when it has reached the path's end. Each step of a
   * path is a tile; the feet keep time with the distance walked (RATE).
   */
  function walk(w, dt, speed) {
    const [nx, ny] = w.path[w.pi],
      dx = nx * TS + 2 - w.x,
      dy = SY(ny) - w.y,
      dist = Math.hypot(dx, dy),
      step = Math.min(dist, speed * (dy ? 0.75 : 1) * dt);
    if (dist > 0.01) {
      w.x += (dx / dist) * step;
      w.y += (dy / dist) * step;
      w.phase += step * RATE;
      if (Math.abs(dx) > 0.2) w.dir = dx > 0 ? 1 : -1;
      w.moving = true;
    }
    if (dist - step >= 0.01) return false;
    w.tx = nx;
    w.ty = ny;
    if (++w.pi < w.path.length) return false;
    w.path = null;
    return true;
  }
  /** Into the hold: from the grass at the gate down onto the top of the stairs. */
  function enter(w) {
    w.tx = EX + (w.d.id & 1);
    w.ty = GR;
    w.x = w.tx * TS + 2;
    w.y = SY(GR);
    w.onSurface = false;
    w.mode = sim.digEnd === undefined ? 'dig' : 'live';
    w.wait = sim.drng.range(0, 0.3);
  }
  /**
   * A dwarf on its way in: hidden until its moment, then walking over the grass to the gate. The first there digs out
   * the top of the stairs from the surface; the rest go straight in.
   */
  function stepArrive(w, t, dt) {
    w.moving = false;
    if (w.at === Infinity) w.at = arriveAt(w.d.id); // a latecomer: its moment is set once the dig is done
    if (t < w.at) return;
    w.hidden = false;
    w.onSurface = true;
    const goal = GATE_X + (w.d.id & 1 ? 2 : -2),
      dx = goal - w.x,
      step = Math.min(Math.abs(dx), WALK * w.d.g.speed * dt);
    if (Math.abs(dx) > 0.5) {
      w.x += Math.sign(dx) * step;
      w.y = SURFI[Math.max(0, Math.min(W - 1, Math.round(w.x)))] - 1;
      w.phase += step * RATE;
      w.dir = Math.sign(dx);
      w.moving = true;
      return;
    }
    if (sim.dug[TOP[0]]) return enter(w);
    if (!sim.taken.has(TOP[0])) {
      for (const tl of TOP) sim.taken.add(tl);
      w.mode = 'dig';
      w.dig = { tiles: TOP, until: t + TILE_S * 4, face: w.dir };
    }
  }
  /**
   * A dwarf at the dig: digging out its chunk (a pick going up and down) until it is done, then off to the next, until
   * the frontier is used up and the hold is dug, when it starts its life there.
   */
  function stepDig(w, t, dt) {
    w.moving = false;
    if (w.dig) {
      w.digging = true;
      w.dir = w.dig.face;
      if (t < w.dig.until) return;
      finishDig(w.dig.tiles, t);
      w.dig = null;
      w.digging = false;
      if (w.onSurface) return enter(w);
      // straight on to the next piece, before anyone across the hold can claim the rock this dwarf has just opened up
    }
    if (sim.digEnd !== undefined) {
      w.mode = 'live';
      w.path = null;
      w.wait = sim.drng.range(0, 1.2);
      return;
    }
    if (w.wait > 0) {
      w.wait -= dt;
      return;
    }
    if (!w.path) {
      // the crew is full: stroll a few steps about the dug part and look again
      if (sim.dw.filter(atWork).length >= CREW) return loiter(w);
      const job = chooseDig(w);
      if (!job) {
        w.wait = sim.drng.range(0.8, 1.6); // nothing to dig within reach just now
        return;
      }
      sim.busyAt = t;
      if (job.path.length - 1 > CLAIM_STEPS) {
        // Far off: head that way without claiming it, so a dwarf nearer can take it meanwhile, and look again on
        // arrival (a far claim would leave the rock idle for the whole walk).
        w.task = null;
        w.heading = true;
        w.path = job.path.slice(0, CLAIM_STEPS + 1);
        w.pi = 1;
        return;
      }
      for (const tl of job.chunk) sim.taken.add(tl);
      w.task = job.chunk;
      if (job.path.length > 1) {
        w.path = job.path;
        w.pi = 1;
        return;
      }
    } else if (!walk(w, dt, (w.loitering ? 14 : 34) * w.d.g.speed)) return;
    if (!w.task) {
      // only heading closer: the next step looks for rock again; or done strolling: a pause first
      w.heading = false;
      if (w.loitering) (w.loitering = false), (w.wait = sim.drng.range(0.8, 2.4));
      return;
    }
    // at the rock: dig it, facing it
    const c = w.task[0] % GW;
    w.dig = { tiles: w.task, until: t + TILE_S * w.task.length, face: c > w.tx ? 1 : c < w.tx ? -1 : w.dir };
    w.task = null;
  }
  // at the dig: digging, or on the way to rock it has claimed (or is heading for)
  const atWork = (w) => w.mode === 'dig' && (w.dig || w.task || w.heading);
  /** A dwarf with no place in the crew: a few steps to somewhere near over the dug floor, slowly, or a pause. */
  function loiter(w) {
    const start = ti(w.tx, w.ty),
      reach = [];
    stamp++;
    SEEN[start] = stamp;
    PREV[start] = -1;
    DEPTH[start] = 0;
    let head = 0,
      tail = 0;
    QUEUE[tail++] = start;
    while (head < tail) {
      const n = QUEUE[head++],
        x = n % GW,
        y = (n / GW) | 0;
      if (DEPTH[n] >= 2) reach.push(n);
      if (DEPTH[n] >= 6) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx,
            ny = y + dy;
          if (!freeNow(nx, ny) || (dx && dy && (!freeNow(x + dx, y) || !freeNow(x, y + dy)))) continue;
          const m = ti(nx, ny);
          if (SEEN[m] === stamp) continue;
          SEEN[m] = stamp;
          PREV[m] = n;
          DEPTH[m] = DEPTH[n] + 1;
          QUEUE[tail++] = m;
        }
    }
    if (!reach.length || sim.drng.next() < 0.3) {
      w.wait = sim.drng.range(0.8, 2);
      return;
    }
    const path = [];
    for (let p = pick(reach); p >= 0; p = PREV[p]) path.push([p % GW, (p / GW) | 0]);
    w.path = path.reverse();
    w.pi = 1;
    w.task = null;
    w.loitering = true;
  }
  /** One dwarf, a moment later. */
  function stepDwarf(w, t, dt) {
    if (w.mode === 'arrive') return stepArrive(w, t, dt);
    if (w.mode === 'dig') return stepDig(w, t, dt);
    const night = k.bedtime(t);
    if (w.sleeping) {
      if (night) return;
      w.sleeping = false;
      w.wait = sim.drng.range(0, 0.6);
    }
    // by day, nobody holds a bed
    if (!night && w.bed) {
      sim.claimed.delete(w.bed);
      w.bed = null;
    }
    // at dusk, whatever a dwarf is doing, it stops and makes for bed
    if (night && !w.hidden && (!w.goal || w.goal.kind !== 'bed')) {
      w.path = null;
      w.wait = Math.min(w.wait, sim.drng.range(0, 0.3));
      w.goal = { kind: 'bed' };
    }
    w.moving = false;
    if (w.wait > 0) {
      w.wait -= dt;
      return;
    }
    w.hidden = false;
    if (!w.path) {
      w.working = false;
      const goal = goalFor(w, night);
      const path = gridAStar([w.tx, w.ty], goal.at, { free, budget: 40000 });
      if (!path || path.length < 2) {
        // already there, or no way: settle where it is for a moment
        if (goal.kind === 'bed' && path) w.sleeping = true;
        else if (goal.kind === 'bed' && w.bed) {
          sim.claimed.delete(w.bed); // no way to that bed: let it go
          w.bed = null;
        }
        w.wait = sim.drng.range(0.4, 1.2);
        w.lastWork = goal.kind === 'work';
        return;
      }
      w.path = path;
      w.pi = 1;
      w.goal = goal;
    }
    // they hurry to bed
    if (walk(w, dt, (w.goal.kind === 'bed' ? 30 : 20) * w.d.g.speed)) {
      const g = w.goal;
      w.lastWork = g.kind === 'work';
      if (g.kind === 'bed' && night) {
        w.sleeping = true;
        w.zAt = 0;
      } else if (g.kind === 'work') {
        w.working = true;
        w.wait = sim.drng.range(2.5, 4.5);
        // a worker faces the thing it works at: away from the stairs, as the rooms are laid out
        w.dir = w.tx >= EX ? 1 : -1;
      } else w.wait = sim.drng.range(1, 2.6);
    }
  }

  /** Everything alive, a moment later (dt seconds), at second t of the film. */
  function step(t, dt) {
    if (!sim.ready) init();
    // drips fall from the ceiling to the water and start again after a pause
    if (t >= T.caves[0] + 0.8)
      sim.drips = sim.drips.map((q) => {
        if (q.wait > 0) return { ...q, wait: q.wait - dt };
        if (q.splash > 0) return q.splash - dt > 0 ? { ...q, splash: q.splash - dt } : { ...q, splash: 0, x: q.sx, y: q.sy, wait: sim.rng.range(0.6, 2.4) };
        const r = fall(q, dt, { speed: 70 }),
          xi = Math.round(r.x),
          yi = Math.round(r.y);
        if (yi >= H - 1 || !CAVE[at(xi, yi)] || WATER[at(xi, yi)]) return { ...r, y: yi, splash: 0.18 };
        return r;
      });
    // embers rise from their fire and start again when spent; a fire's embers wait for its fire to be lit
    if (t >= T.caves[0] + 0.5)
      sim.embers = sim.embers.map((q) => {
        const lit = q.src.magma || t >= itemAt(q.src.item); // a fire burns once its room is dug and it is built
        if (!lit) return q;
        const r = rise(q, dt, { speed: q.src.magma ? 6 : 10, spread: 9, sway: [3, 5] });
        r.life += dt;
        if (r.life > 1 + q.s * 0.7) return { ...r, x: q.src.x + sim.rng.range(-1.5, 1.5), y: q.src.y, life: 0 };
        return r;
      });
    // the bats wheel round their cavern
    if (t >= T.caves[1]) {
      if (!sim.bats) initBats();
      if (sim.bats.length) {
        const c = sim.batCave,
          low = Math.min(c.level, c.bottom) - 4;
        sim.bats = flockStep(sim.bats, dt, {
          cohesion: 0.5,
          alignment: 0.6,
          separation: { within: 5, push: 30 },
          speed: [12, 24],
          band: { from: c.top + 4, to: Math.max(c.top + 8, low), pull: 3 },
          keepCentre: { origin: c.cx, from: -16, to: 16, pull: 1.4 },
          wander: { t, rate: [0.7, 1.1], amount: [14, 9] },
        });
      }
    }
    // the dwarves: arriving from the start of the arrival, digging, then living there; if the dig runs very long, the
    // last of it is done at once
    if (t >= T.embark[0]) {
      if (!sim.dw) initDwarves();
      for (const w of sim.dw) stepDwarf(w, t, dt);
      // The last of the rock is dug at once if the dwarves cannot get at it: nobody has had any digging to do for three
      // seconds (rock with nowhere to stand beside it), or the dig has run far too long.
      if (sim.digEnd === undefined && t > T.dig[0] + 2) {
        if (sim.dw.some((w) => w.dig || w.task)) sim.busyAt = t;
        if (t - (sim.busyAt || t) > 3 || t > T.dig[0] + DIG_CAP) finishAll(t);
      }
      // a sleeper breathes out a z now and then; each rises in pulses and fades
      for (const w of sim.dw)
        if (w.sleeping) {
          w.zAt = (w.zAt || 0) - dt;
          if (w.zAt <= 0) {
            w.zAt = 1.1 + sim.rng.range(0, 0.4);
            sim.zs.push({ x: w.x + 1, y: w.y - 5, phase: 0, seed: w.d.id, life: 0 });
          }
        }
    }
    sim.zs = sim.zs
      .map((z) => ({ ...pulseRise(z, dt, t, { rate: 3, push: 8, sway: [1.6, 2] }), life: z.life + dt }))
      .filter((z) => z.life < 1.6);
    // fireflies drift along the grass and wrap round the picture's edges
    if (t >= T.lights[0])
      sim.flies = sim.flies.map((q) => {
        const r = wrapAround(hover(q, dt, { x: [1.3, 6], y: [1.7, 3], camera: -3 }), W, H, 4);
        return r;
      });
  }

  return { sim, step, DWARVES, RATE, itemAt, WALK, FROM, DIG_S, DIG_CAP, TILE_S, PLANNED, CREW };
}
