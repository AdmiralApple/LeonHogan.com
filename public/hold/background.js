// The hold as a page's living background, played for ever. One call:
//
//   import { mountHoldBackground } from './background.js';
//   mountHoldBackground({ seed: 'my-hold' });                  // fixed behind the page, the size of the window
//   mountHoldBackground({ seed: 'my-hold', mode: 'scroll' });  // as deep as the page, scrolling down with it
//
// In 'fixed' mode the hold fills the window and stays put while the page scrolls over it. In 'scroll' mode it is as
// tall as the page: the surface at the top, then level after level of the hold, cavern layers between them, and magma
// at the very bottom of the page. Only the rows in sight are painted each frame, so a deep hold costs no more to play
// than a window-sized one. (A very long page would make a hold too big to keep in memory: there the hold is cut to
// size and scrolls a little slower than the page, so its bottom still arrives with the page's.)
//
// The hold is built and played in a worker (hold-worker.js) drawing straight into the canvas, so the page stays
// responsive; where a browser cannot hand a canvas to a worker, it plays on the page instead. It pauses while the tab
// is hidden, shows a still picture to anyone who asks for reduced motion, and carries its hour of the day from one page
// of a site to the next (in sessionStorage), so moving between pages does not set the clock back.

const KEY = 'procedural-hold';

// A seed phrase picked at random (a stone or a metal, a place under a mountain, a number), for a new hold every load.
const FIRST = ['amber', 'anvil', 'ash', 'basalt', 'bronze', 'cinder', 'copper', 'flint', 'garnet', 'granite', 'iron',
  'jasper', 'marble', 'obsidian', 'onyx', 'quartz', 'ruby', 'slate', 'silver', 'tin', 'umber', 'zinc', 'coal', 'gold'];
const SECOND = ['deep', 'delve', 'hall', 'hold', 'forge', 'vault', 'mine', 'gate', 'hollow', 'reach', 'barrow', 'crag',
  'keep', 'stair', 'cavern', 'shaft', 'seam', 'lode', 'warren', 'grotto'];
const pickOf = (list) => list[Math.floor(Math.random() * list.length)];
const randomSeed = () => `${pickOf(FIRST)}-${pickOf(SECOND)}-${Math.floor(Math.random() * 100)}`;

/**
 * Mounts the hold behind the page.
 * @param {object} [o]
 * @param {string} [o.seed] the hold's seed: the same seed (and size) gives the same hold. Leave it out for a new hold,
 *   from a seed picked at random, every time the page loads
 * @param {'fixed'|'scroll'} [o.mode] fixed behind the page, or as deep as the page and scrolling with it
 * @param {number} [o.scale] screen pixels to one of the hold's pixels (2: a big hold of small dwarves; 3: bigger dwarves)
 * @param {boolean|'once'} [o.intro] play the build-up from the seed first: true, false, or 'once' (the first page of a
 *   visit only)
 * @param {number} [o.maxDwarves] how many dwarves at most (otherwise one for about every 6,000 pixels of the hold)
 * @param {number} [o.maxPixels] the most pixels a scrolling hold may have (memory: about 65 bytes each)
 * @param {function(): number} [o.darkness] how dark it is underground, 0..1, asked again whenever the page's theme
 *   changes (by default: 1 in a dark theme, 0.4 in a light one)
 * @param {HTMLElement} [o.parent] where to put the canvas (the body)
 * @returns {{canvas: HTMLCanvasElement, seed: string, update: function(): void, stop: function(): void}}
 */
export function mountHoldBackground(o = {}) {
  const parent = o.parent || document.body,
    scroll = o.mode === 'scroll',
    scale = o.scale || 2,
    still = matchMedia('(prefers-reduced-motion: reduce)').matches,
    root = document.documentElement;
  const round4 = (v) => Math.round(v / 4) * 4;
  const docH = () => Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight);
  // the hold's size in its own pixels: the window over the scale, in whole tiles, within sensible bounds; in scroll
  // mode as tall as the page, as far as the pixel budget allows (less on small devices)
  const W = Math.max(320, Math.min(1600, round4(innerWidth / scale)));
  const small = innerWidth < 700 || (navigator.deviceMemory && navigator.deviceMemory < 4);
  const budget = o.maxPixels || (small ? 700000 : 1600000);
  const H = scroll
    ? Math.max(round4(innerHeight / scale), Math.min(round4(docH() / scale), Math.floor(budget / W / 4) * 4))
    : Math.max(200, Math.min(900, round4(innerHeight / scale)));

  const canvas = document.createElement('canvas');
  canvas.className = 'hold-bg';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = W;
  canvas.height = H;
  Object.assign(
    canvas.style,
    {
      position: 'fixed',
      left: '0',
      top: '0',
      imageRendering: 'pixelated',
      zIndex: '-2',
      pointerEvents: 'none',
      // hidden until its first frame is drawn, then faded in, so the page never jumps from bare to busy
      opacity: '0',
      transition: still ? 'none' : 'opacity 1.8s ease',
    },
    scroll
      ? { width: '100%', height: 'auto', willChange: 'transform' }
      : { inset: '0', width: '100%', height: '100%', objectFit: 'cover' },
  );
  parent.prepend(canvas);

  // the hour carried over from the last page, wound on by the time spent getting here
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
  } catch {}
  const DAYLEN = 90; // seconds a day, as scene.js has it
  const clockNow = saved ? saved.clock + (Date.now() - saved.at) / 1000 / DAYLEN : null;
  const intro = o.intro === 'once' ? !saved : !!o.intro;
  // whether the page is dark: then the hold is dark underground, its noise dim and its build-up softly lit
  const isDark = () => {
    const t = root.dataset.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const darkFor = o.darkness || (() => (isDark() ? 1 : 0.4));
  const show = () => requestAnimationFrame(() => (canvas.style.opacity = '1'));
  const remember = (clock) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ clock, at: Date.now() }));
    } catch {}
  };
  if (clockNow === null) remember(0.12);

  // In scroll mode: where the hold sits for the page's scroll, and which of its rows are in sight. k is screen pixels
  // to a hold pixel; rate is how far the hold moves for each pixel the page scrolls (1 when it is as deep as the page).
  let post = () => {},
    lastView = null;
  const MARGIN = 48; // rows painted beyond the window's edges every frame, so a scroll lands on live rows
  function place() {
    if (!scroll) return;
    const k = (canvas.clientWidth || root.clientWidth || innerWidth) / W, // its shown width, less any scrollbar
      tall = H * k;
    if (!(k > 0)) return; // not laid out yet (a hidden tab or frame): wait for the next scroll or resize
    const room = Math.max(0, docH() - innerHeight),
      rate = room > 0 ? Math.max(0, tall - innerHeight) / room : 0,
      off = Math.min(Math.max(0, tall - innerHeight), scrollY * rate);
    canvas.style.transform = `translate3d(0, ${-off}px, 0)`;
    const y0 = Math.max(0, Math.floor(off / k) - MARGIN),
      y1 = Math.min(H, Math.ceil((off + innerHeight) / k) + MARGIN);
    if (!lastView || Math.abs(lastView[0] - y0) > 1 || Math.abs(lastView[1] - y1) > 1) {
      lastView = [y0, y1];
      post({ type: 'view', y0, y1 });
    }
  }

  const seed = o.seed || randomSeed();
  canvas.dataset.seed = seed; // which hold this is, for anyone curious (or to ask for it again with o.seed)
  const opts = {
    seed,
    W,
    H,
    intro,
    still,
    maxDwarves: o.maxDwarves || Math.max(8, Math.min(120, Math.round((W * H) / 6000))),
    clock: clockNow === null ? 0 : clockNow - 0.12, // scene.js counts its first day from 0.12
    darkness: darkFor(),
    dim: isDark(),
  };
  place(); // works out the first view before anything is drawn
  opts.view = scroll ? lastView : null;

  let stop;
  if (canvas.transferControlToOffscreen && typeof Worker !== 'undefined') {
    const worker = new Worker(new URL('./hold-worker.js', import.meta.url), { type: 'module' });
    const off = canvas.transferControlToOffscreen();
    worker.onmessage = (e) => {
      if (e.data.type === 'clock') remember(e.data.clock);
      else if (e.data.type === 'ready') show();
    };
    worker.postMessage({ type: 'start', canvas: off, ...opts }, [off]);
    post = (m) => worker.postMessage(m);
    stop = () => worker.terminate();
  } else {
    // no OffscreenCanvas: build and play it here, on the page
    let scene, f, raf, last, acc = 0, playing = !still, view = opts.view || [0, H];
    const ctx = canvas.getContext('2d');
    import('./scene.js').then(({ hold }) => {
      scene = hold(opts.seed, { ...opts, captions: false, mark: false });
      const img = new ImageData(scene.W, scene.H);
      const draw = () => {
        const [y0, y1] = view,
          px = scene.frame(f, y0, y1);
        img.data.set(new Uint8ClampedArray(px.buffer, px.byteOffset + y0 * W * 4, (y1 - y0) * W * 4), y0 * W * 4);
        ctx.putImageData(img, 0, 0, 0, y0, W, y1 - y0);
      };
      f = intro ? 0 : scene.settle();
      const all = view;
      view = [0, scene.H];
      draw(); // the whole of it once, so no row is ever blank
      view = all;
      show();
      const loop = (now) => {
        if (playing) {
          acc += Math.min(250, now - (last || now));
          let moved = false;
          while (acc >= 1000 / scene.FPS) (acc -= 1000 / scene.FPS), f++, (moved = true);
          if (moved) {
            draw();
            if (f % (scene.FPS * 2) === 0) remember(scene.clockAt(f / scene.FPS));
          }
        }
        last = now;
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      post = (m) => {
        if (m.type === 'pause') playing = false;
        else if (m.type === 'resume') playing = !still;
        else if (m.type === 'darkness') scene.setDarkness(m.value), scene.setDim(m.dim), draw();
        else if (m.type === 'view') (view = [m.y0, m.y1]), playing || draw();
      };
    });
    stop = () => cancelAnimationFrame(raf);
  }

  // follow the scroll (once a frame at most), the window's size and the page's own height as it settles
  if (scroll) {
    let queued = false;
    const soon = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        place();
      });
    };
    addEventListener('scroll', soon, { passive: true });
    addEventListener('resize', soon);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(soon).observe(document.body);
  }
  // pause while the tab is hidden; follow the page's theme
  document.addEventListener('visibilitychange', () => !still && post({ type: document.hidden ? 'pause' : 'resume' }));
  const update = () => post({ type: 'darkness', value: darkFor(), dim: isDark() });
  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', update);
  return { canvas, seed, update, stop };
}
