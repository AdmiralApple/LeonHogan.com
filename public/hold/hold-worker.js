// The hold, built and played in a worker, drawn straight into a canvas handed over from the page (an OffscreenCanvas),
// so the page never waits on it: background.js starts it. Messages in: start, view (which rows are in sight, for a
// tall hold behind a scrolling page), pause, resume, darkness. Messages out: ready (once built) and clock (now and
// then, so the page can carry the hour on to the next page).
import { hold } from './scene.js';

let scene = null,
  ctx = null,
  img = null,
  f = 0,
  playing = true,
  timer = 0,
  next = 0,
  view = [0, 0];

/** Rows y0..y1 of frame f painted and put into the canvas. */
function paint(y0, y1) {
  if (y1 <= y0) return;
  const px = scene.frame(f, y0, y1),
    W = scene.W;
  img.data.set(new Uint8ClampedArray(px.buffer, px.byteOffset + y0 * W * 4, (y1 - y0) * W * 4), y0 * W * 4);
  ctx.putImageData(img, 0, 0, 0, y0, W, y1 - y0);
}
// Rows out of sight are kept fresh too, a band at a time going round the whole hold, so that a quick scroll never
// shows a row that was never painted (at worst one a moment out of date). SWEEP is where the band has got to.
let sweep = 0;
/** One frame: the rows in sight, and the next band of the rest. */
function draw() {
  const [y0, y1] = view,
    H = scene.H,
    band = Math.max(24, Math.ceil(H / 16));
  paint(y0, y1);
  if (y1 - y0 < H) {
    if (sweep >= H) sweep = 0;
    const b0 = sweep,
      b1 = Math.min(H, sweep + band);
    sweep = b1;
    // only the part of the band not just painted
    if (b1 <= y0 || b0 >= y1) paint(b0, b1);
    else {
      paint(b0, y0);
      paint(y1, b1);
    }
  }
}

/** Plays at the scene's own rate, catching up a frame or two if the worker was kept waiting, never more. */
function tick() {
  if (!playing) return;
  const now = performance.now(),
    ms = 1000 / scene.FPS;
  let steps = 0;
  while (next <= now && steps < 3) {
    f++;
    next += ms;
    steps++;
  }
  if (next < now) next = now + ms; // fell far behind (the tab was asleep): carry on from now
  if (steps) {
    draw();
    if (f % (scene.FPS * 2) === 0) postMessage({ type: 'clock', clock: scene.clockAt(f / scene.FPS) });
  }
  timer = setTimeout(tick, Math.max(1, next - performance.now()));
}

const setView = (y0, y1) => {
  view = [Math.max(0, Math.floor(y0)), Math.min(scene.H, Math.ceil(y1))];
  // nonsense in (a page not laid out yet can send it): fall back to all of it
  if (!Number.isFinite(view[0]) || !Number.isFinite(view[1]) || view[1] <= view[0]) view = [0, scene.H];
};

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'start') {
    const t0 = performance.now();
    scene = hold(m.seed, {
      W: m.W,
      H: m.H,
      intro: m.intro,
      captions: false,
      mark: false,
      maxDwarves: m.maxDwarves,
      clock: m.clock,
      darkness: m.darkness,
      dim: m.dim,
    });
    m.canvas.width = scene.W;
    m.canvas.height = scene.H;
    ctx = m.canvas.getContext('2d');
    img = new ImageData(scene.W, scene.H);
    f = m.intro ? 0 : scene.settle(); // a hold that starts built: its dwarves dig it first, out of sight
    setView(m.view ? m.view[0] : 0, m.view ? m.view[1] : scene.H);
    paint(0, scene.H); // the whole of it once, so no row is ever blank
    draw();
    postMessage({ type: 'ready', W: scene.W, H: scene.H, ms: Math.round(performance.now() - t0) });
    playing = !m.still;
    next = performance.now();
    if (playing) tick();
  } else if (!scene) return;
  else if (m.type === 'view') {
    // a scroll: paint the rows that have come into sight straight away, not at the next frame
    const [a0, a1] = view;
    setView(m.y0, m.y1);
    const [b0, b1] = view;
    if (b0 < a0) paint(b0, Math.min(a0, b1));
    if (b1 > a1) paint(Math.max(a1, b0), b1);
  } else if (m.type === 'pause') {
    playing = false;
    clearTimeout(timer);
  } else if (m.type === 'resume' && !playing) {
    playing = true;
    next = performance.now();
    tick();
  } else if (m.type === 'darkness') {
    scene.setDarkness(m.value);
    scene.setDim(m.dim);
    if (!playing) draw();
  }
};
