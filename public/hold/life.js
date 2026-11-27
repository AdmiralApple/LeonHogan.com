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
  const { at, free, SY, BEDS, SEATS, SPOTS, EX, GR, ITEMS, LAKES, CAVE, WATER, MAT, SURF, BMI, ROOMS } = world;
  const make = new SeededRandom(SEED + 100);

  // the dwarves' kind: each gene a range, a list or a chance
  const KIND = {
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
  for (let i = 0; i < count; i++) DWARVES.push({ id: i, g: genomeFrom(KIND, make), bed: BEDS[i] || null, job: 'hall' });
  // the youngest one or two are children of the first couples
  DWARVES[count - 1].g = { ...crossGenomes(DWARVES[0].g, DWARVES[1].g, KIND, make), child: true };
  if (count >= 12) DWARVES[count - 2].g = { ...crossGenomes(DWARVES[2].g, DWARVES[3].g, KIND, make), child: true };
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

  const sim = { f: -1 };
  /** Sets up what lives in the hold the first time it is stepped (and again after the timeline is wiped). */
  function init() {
    sim.rng = new SeededRandom(SEED + 200);
    sim.ready = true;
    sim.claimed = new Set(); // the beds taken tonight
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

  /**
   * The dwarves arrive down the stairs at the start of furnishing, one after another; or, in a hold that starts
   * already built, each is somewhere about its day already: at its work, or wherever else it has got to.
   */
  function initDwarves() {
    sim.dw = DWARVES.map((d, i) => {
      const at0 = k.intro ? [EX + (i & 1), GR] : SPOTS[d.job] && SPOTS[d.job].length && sim.rng.chance(0.6) ? pick(SPOTS[d.job]) : pick(PLACES.length ? PLACES : [[EX, GR]]);
      return {
        d,
        tx: at0[0],
        ty: at0[1],
        x: at0[0] * TS + 2,
        y: SY(at0[1]),
        dir: sim.rng.chance(0.5) ? 1 : -1,
        phase: 0,
        moving: false,
        wait: k.intro ? i * 0.18 : sim.rng.range(0, 2),
        hidden: k.intro,
        path: null,
        working: false,
        sleeping: false,
        goal: null,
      };
    });
  }
  const pick = (list) => list[Math.floor(sim.rng.next() * list.length)];
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
    const r = sim.rng.next();
    if (r < 0.45 && SEATS.length) return { at: pickNear(SEATS, w), kind: 'eat' };
    return { at: pickNear(PLACES.length ? PLACES : [[EX, GR]], w), kind: 'wander' };
  }
  /** One dwarf, a moment later. */
  function stepDwarf(w, t, dt) {
    const night = k.bedtime(t);
    if (w.sleeping) {
      if (night) return;
      w.sleeping = false;
      w.wait = sim.rng.range(0, 0.6);
    }
    // by day, nobody holds a bed
    if (!night && w.bed) {
      sim.claimed.delete(w.bed);
      w.bed = null;
    }
    // at dusk, whatever a dwarf is doing, it stops and makes for bed
    if (night && !w.hidden && (!w.goal || w.goal.kind !== 'bed')) {
      w.path = null;
      w.wait = Math.min(w.wait, sim.rng.range(0, 0.3));
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
        w.wait = sim.rng.range(0.4, 1.2);
        w.lastWork = goal.kind === 'work';
        return;
      }
      w.path = path;
      w.pi = 1;
      w.goal = goal;
    }
    const [nx, ny] = w.path[w.pi],
      gx = nx * TS + 2,
      gy = SY(ny),
      dx = gx - w.x,
      dy = gy - w.y,
      dist = Math.hypot(dx, dy),
      speed = (w.goal.kind === 'bed' ? 30 : 20) * w.d.g.speed * (dy ? 0.75 : 1), // they hurry to bed
      step = Math.min(dist, speed * dt);
    if (dist > 0.01) {
      w.x += (dx / dist) * step;
      w.y += (dy / dist) * step;
      w.phase += step * RATE;
      if (Math.abs(dx) > 0.2) w.dir = dx > 0 ? 1 : -1;
      w.moving = true;
    }
    if (dist - step < 0.01) {
      w.tx = nx;
      w.ty = ny;
      if (++w.pi >= w.path.length) {
        w.path = null;
        const g = w.goal;
        w.lastWork = g.kind === 'work';
        if (g.kind === 'bed' && night) {
          w.sleeping = true;
          w.zAt = 0;
        } else if (g.kind === 'work') {
          w.working = true;
          w.wait = sim.rng.range(2.5, 4.5);
          // a worker faces the thing it works at: away from the stairs, as the rooms are laid out
          w.dir = w.tx >= EX ? 1 : -1;
        } else w.wait = sim.rng.range(1, 2.6);
      }
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
        const lit = q.src.magma || t >= T.furnish[0] + q.src.item.appear * (T.furnish[1] - T.furnish[0]);
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
    // the dwarves
    if (t >= T.furnish[0]) {
      if (!sim.dw) initDwarves();
      for (const w of sim.dw) stepDwarf(w, t, dt);
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

  return { sim, step, DWARVES, RATE };
}
