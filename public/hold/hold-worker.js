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

/** One frame: the hold moved on to frame f and the rows in sight painted and put into the canvas. */
function draw() {
  const [y0, y1] = view,
    px = scene.frame(f, y0, y1),
    W = scene.W;
  img.data.set(new Uint8ClampedArray(px.buffer, px.byteOffset + y0 * W * 4, (y1 - y0) * W * 4), y0 * W * 4);
  ctx.putImageData(img, 0, 0, 0, y0, W, y1 - y0);
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
  if (view[1] <= view[0]) view = [0, scene.H];
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
    });
    m.canvas.width = scene.W;
    m.canvas.height = scene.H;
    ctx = m.canvas.getContext('2d');
    img = new ImageData(scene.W, scene.H);
    f = m.intro ? 0 : Math.round(scene.T.life[0] * scene.FPS);
    setView(m.view ? m.view[0] : 0, m.view ? m.view[1] : scene.H);
    draw();
    postMessage({ type: 'ready', W: scene.W, H: scene.H, ms: Math.round(performance.now() - t0) });
    playing = !m.still;
    next = performance.now();
    if (playing) tick();
  } else if (!scene) return;
  else if (m.type === 'view') {
    setView(m.y0, m.y1);
    if (!playing) draw(); // a still picture still follows the scroll
  } else if (m.type === 'pause') {
    playing = false;
    clearTimeout(timer);
  } else if (m.type === 'resume' && !playing) {
    playing = true;
    next = performance.now();
    tick();
  } else if (m.type === 'darkness') {
    scene.setDarkness(m.value);
    if (!playing) draw();
  }
};
