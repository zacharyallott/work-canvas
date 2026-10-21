import { Layout } from '../core/layout.js';
import { ARTBOARD } from '../core/defaults.js';
import { Spring } from '../core/spring.js';
import { sizePattern } from '../core/sizing.js';

/**
 * Version E — Universe (Figma frames 1613:69 desktop, 1613:93 full grid)
 *
 * A field of tiles that runs well past the view in every direction. The
 * positions are the sketch's 28 places across a 4269 × 2605 design-px field,
 * repeated side by side as many times as the collection (and the screen) needs
 * and wrapped both ways, so it never runs out. No image shows twice in a view:
 * if the collection is too small to fill every repeat, a place reuses the
 * piece from the same place in the first repeat (a whole field away, so the
 * two rarely meet), and a tile coming into view whose piece is already on
 * screen (wide or tall screens see more than one field) takes the piece that's
 * been off screen longest, before it's drawn. Tiles are 400 design px wide
 * with their height from the piece's real aspect ratio.
 *
 * Depth: each place belongs to one of four layers, back to front. A layer's
 * tiles are drawn above the layers behind it, get a little larger the nearer
 * the layer, and move at their layer's pace — the nearer, the faster — so as
 * the field moves the layers slide over one another (parallax).
 *
 * Motion: the cursor steers a sideways drift — left of centre drifts right,
 * right of centre drifts left, faster towards the edges — slowing right down
 * while a tile is hovered so it's easy to click. Scrolling (wheel / trackpad)
 * pans the field: vertical scroll moves it up and down, horizontal scroll
 * across, eased through springs like the other versions. On touch the finger
 * drags the field in any direction and a flick carries on. With nothing
 * happening it drifts slowly. On load the tiles fade in layer by layer, front
 * to back. Hovering a tile brings it to the front, with its title.
 */
export const config = {
  // Layout (design px at the 1280×794 artboard; scaled by mount height)
  tileWidth: 400,
  field: { width: 4269, height: 2605 }, // one repeat of the sketch's places
  // The sketch's places: [left, top, height] of each 400-px-wide tile (their centres are used).
  places: [
    [2033, 1292, 516], [2575, 1431, 306], [1980, 2194, 306], [2298, 797, 435], [3691, 1373, 435],
    [3691, 257, 435], [1780, 607, 250], [3072, 474, 516], [3149, 1125, 306], [2872, 1566, 435],
    [2233, 1893, 435], [2575, 871, 250], [3349, 575, 250], [1250, 172, 250], [917, 651, 516],
    [626, 1678, 516], [1399, 1630, 306], [917, 1373, 435], [426, 422, 435], [426, 1278, 250],
    [3443, 1635, 516], [1724, 1149, 306], [226, 297, 306], [2433, 321, 306], [3149, 2244, 306],
    [1538, 515, 435], [1250, 2065, 435], [1199, 1042, 250],
  ],
  start: { x: -1605, y: -1081 }, // where the view first sits over the field (the desktop frame)
  spacing: 0.85, // the places (and the field) are drawn at this fraction of the sketch's spacing (lower = denser, more overlap); tiles keep their size
  portraitSpacing: 0.68, // portrait screens (phones): `spacing` there — their tiles are capped smaller (mobileMaxWidth), so a little tighter
  // Four layers, back → front: how fast each moves (× the field's motion) — the nearer, the faster — and how big
  // its tiles are.
  layers: { pace: [0.5, 0.8, 1.1, 1.45], scale: [0.8, 0.92, 1.03, 1.14] },
  seed: 5, // shuffles which place belongs to which layer
  minAspect: 0.75, // taller than this gets cropped
  maxAspect: 1.8, // wider than this gets cropped
  minScale: 0.55,
  maxScale: 1, // keeps the biggest (front, portrait) tiles within a 1280 px texture on 2× screens
  mobileMaxWidth: 0.6, // tile width never exceeds this fraction of the view width (phones)

  // Cursor drift (px/s at pace 1)
  maxSpeed: 150, // with the cursor at either edge
  deadZone: 0.08, // fraction of the half-width around the centre with no drift
  curve: 1.6, // >1 = gentle near the centre, quick toward the edges
  response: 2, // how fast the drift follows the cursor (higher = less lag)
  idle: { x: -8, y: -3 }, // px/s drift with no cursor over the header
  hoverSlowdown: 0.15, // drift multiplier while a tile is hovered (so it's easy to click)
  hoverEase: 3,

  // Scroll: wheel / trackpad pans the field, eased by a spring per axis (see spring.js: maxLead caps a flick's
  // speed and how long it runs on). Vertical scroll pans up/down; horizontal scroll pans across.
  scroll: { multiplier: 0.4, omega: 6, maxLead: 160 },
  // Touch: the finger drags the field; a flick carries on.
  dragMultiplier: 0.7,
  throw: 0.9,
  inertia: 0.94, // momentum kept per 1/60 s

  hover: { zoom: 0, speed: 7 },
  maxVideos: 4,

  // Entrance: layer by layer, front to back, each dissolving in place.
  easing: 'none',
  stagger: 1.2,
  enterDuration: 1.4,
  leaveDuration: 0.25,
  captionInset: [20, 12],
};

export default class Universe extends Layout {
  static defaults = config;
  static label = 'Universe';

  constructor(engine, cfg) {
    super(engine, cfg);
    this.pan = { x: 0, y: 0 }; // px (pace 1) from drift and swipes
    this.drift = { x: cfg.idle.x, y: cfg.idle.y }; // px/s, eased toward the cursor's
    this.velocity = { x: 0, y: 0 }; // px/s from touch throws
    const spring = () => new Spring(cfg.scroll.omega, { maxLead: cfg.scroll.maxLead });
    this.scrolled = { x: spring(), y: spring() };
    this.slow = 1;
    this.frame = 0;
    this.seenAt = new Map(); // piece → the frame it was last on screen
  }

  resize(vp) {
    const c = this.config;
    const s = Math.min(c.maxScale, Math.max(c.minScale, vp.height / ARTBOARD.height));
    this.s = s;
    this.engine.scale = s;
    const n = c.places.length;
    const items = this.items;
    const base = Math.min(c.tileWidth * s, vp.width * c.mobileMaxWidth);
    this.spacing = vp.width < vp.height ? c.portraitSpacing ?? c.spacing : c.spacing;
    const d = this.spacing * s; // design px of the field → CSS px on screen
    // Repeats: side by side, enough for every piece to have a place; and in both directions, enough that the view
    // plus a tile fits inside them, so a tile only ever wraps round off screen.
    const widest = base * Math.max(...c.layers.scale);
    const tallest = widest / c.minAspect;
    const kx = Math.max(1, Math.ceil(items.length / n), Math.ceil((vp.width + widest + 2) / (c.field.width * d)));
    const ky = Math.max(1, Math.ceil((vp.height + tallest + 2) / (c.field.height * d)));
    const count = n * kx * ky;
    if (count !== this.tiles.length) {
      this.tiles.forEach((t) => t.dispose());
      // One piece per place; past the end of the collection, reuse the piece at the same place in the first
      // repeat (a whole field away, same layer, same pace), the farthest a copy can be from its original.
      this.makeTiles(Array.from({ length: count }, (_, i) => items[i < items.length ? i : (i % n) % items.length]));
    }
    this.tiles.forEach((t) => (t.inView = false)); // re-check every tile on screen for repeats (see update)
    const layerOf = sizePattern(n, c.layers.pace.length, c.seed); // per place, so each repeat keeps the same depth
    this.period = { x: c.field.width * kx * d, y: c.field.height * ky * d };
    this.tiles.forEach((t, i) => {
      const p = i % n;
      const copy = Math.floor(i / n);
      const [left, top, h] = c.places[p];
      t.layer = layerOf[p];
      t.pace = c.layers.pace[t.layer];
      t.w = base * c.layers.scale[t.layer];
      this.fit(t);
      // Centre in the field (design px → CSS px), in its repeat.
      t.fx = (left + 200 + (copy % kx) * c.field.width) * d;
      t.fy = (top + h / 2 + Math.floor(copy / kx) * c.field.height) * d;
    });
    this.margin = { x: widest / 2 + 1, y: tallest / 2 + 1 }; // tiles wrap once they're fully off screen
  }

  /** A tile's height from its piece's aspect ratio (its width is its layer's). */
  fit(t) {
    const c = this.config;
    t.h = t.w / Math.min(c.maxAspect, Math.max(c.minAspect, t.item.aspect || 1));
  }

  /** Puts `item` on tile `t` (off screen, or coming into view and not drawn yet), keeping the tile's centre. */
  give(t, item) {
    const cy = t.y + t.h / 2;
    t.item = item;
    if (!item.ready) t.texReady = 0; // fade in once it loads, rather than pop
    this.fit(t);
    t.y = cy - t.h / 2;
  }

  /** Target sideways drift (px/s) for the current cursor position. */
  targetDrift() {
    const c = this.config;
    const { nx, inside } = this.engine.cursor;
    if (!inside) return this.reduced ? { x: 0, y: 0 } : { x: c.idle.x * this.s, y: c.idle.y * this.s };
    const mag = Math.max(0, (Math.abs(nx) - c.deadZone) / (1 - c.deadZone));
    // Cursor left (nx < 0) → positive speed → the field moves right.
    return { x: -Math.sign(nx) * Math.pow(mag, c.curve) * c.maxSpeed * this.s, y: 0 };
  }

  update(dt) {
    const c = this.config;
    const e = this.engine;
    const { width, height } = this.vp;
    const hovering = e.hovered && this.tiles.includes(e.hovered);
    this.slow += ((hovering ? c.hoverSlowdown : 1) - this.slow) * (1 - Math.exp(-dt * c.hoverEase));

    const want = this.targetDrift();
    const r = 1 - Math.exp(-dt * c.response);
    this.drift.x += (want.x - this.drift.x) * r;
    this.drift.y += (want.y - this.drift.y) * r;
    this.pan.x += (this.drift.x * this.slow + this.velocity.x) * dt;
    this.pan.y += (this.drift.y * this.slow + this.velocity.y) * dt;
    const keep = Math.pow(c.inertia, dt * 60);
    this.velocity.x *= keep;
    this.velocity.y *= keep;
    const ox = c.start.x * this.spacing * this.s + this.pan.x + this.scrolled.x.update(dt);
    const oy = c.start.y * this.spacing * this.s + this.pan.y + this.scrolled.y.update(dt);

    const { x: Px, y: Py } = this.period;
    const { x: mx, y: my } = this.margin;
    const wrap = (v, period, m) => ((((v + m) % period) + period) % period) - m; // into [-m, period - m)
    let featured = null;
    let bestScore = 0;

    // Where every tile is, and which pieces are already on screen.
    const shown = new Set();
    const entering = [];
    for (const t of this.tiles) {
      t.x = wrap(t.fx + ox * t.pace, Px, mx) - t.w / 2;
      t.y = wrap(t.fy + oy * t.pace, Py, my) - t.h / 2;
      const inView = t.x + t.w > 0 && t.x < width && t.y + t.h > 0 && t.y < height;
      if (inView && !t.inView) entering.push(t);
      else if (inView) shown.add(t.item);
      t.inView = inView;
    }
    // A tile coming into view whose piece is already on screen takes the piece that's been off screen longest
    // (none free: more tiles in view than pieces, so it keeps its own). This frame is its first drawn, so the swap
    // is never seen.
    this.frame++;
    for (const t of entering) {
      if (shown.has(t.item)) {
        let free = null;
        let freeAt = Infinity;
        for (const item of this.items) {
          const at = this.seenAt.get(item) ?? -1;
          if (!shown.has(item) && at < freeAt) [free, freeAt] = [item, at];
        }
        if (free) this.give(t, free);
      }
      shown.add(t.item);
    }
    for (const item of shown) this.seenAt.set(item, this.frame);

    this.tiles.forEach((t, i) => {
      t.z = t.layer * 1000 + i; // back → front
      t.rotation = 0;
      t.alpha = 1;
      t.reveal = 1;
      t.priority = t.inView ? this.centerScore(t) : 0;
      if (t.priority > bestScore) {
        bestScore = t.priority;
        featured = t;
      }
      this.applyTransition(t, 1 - t.layer / (c.layers.pace.length - 1)); // front layer first, back last
    });

    this.featured = featured;
    if (featured) featured.priority = 2;
    if (hovering) {
      e.hovered.priority = 3;
      e.hovered.z = 100000; // a hovered tile comes to the front, above every layer
    }
  }

  /** Scroll down = the field moves up; horizontal scroll moves it across. */
  onWheel({ dx, dy }) {
    const m = this.config.scroll.multiplier;
    this.scrolled.x.push(-dx * m);
    this.scrolled.y.push(-dy * m);
  }

  // Touch: the field follows the finger in any direction.
  onDrag({ dx, dy }) {
    if (!this.engine.touch) return;
    const m = this.config.dragMultiplier;
    this.pan.x += dx * m;
    this.pan.y += dy * m;
    this.velocity.x = 0;
    this.velocity.y = 0;
  }

  onRelease({ vx, vy }) {
    if (!this.engine.touch) return;
    const k = this.config.dragMultiplier * this.config.throw;
    this.velocity.x = vx * k;
    this.velocity.y = vy * k;
  }

  /** Keyboard focus: glide the nearest copy of the item to the middle of the view. */
  focusItem(item) {
    let tile = this.tileForItem(item);
    if (!tile) {
      // Every tile that had it has taken another piece: give it to the off-screen tile nearest the view whose own
      // piece another tile also has (so no piece loses its last tile).
      const { width, height } = this.vp;
      const far = (t) => Math.hypot(t.x + t.w / 2 - width / 2, t.y + t.h / 2 - height / 2);
      const holders = new Map();
      for (const t of this.tiles) holders.set(t.item, (holders.get(t.item) ?? 0) + 1);
      tile = this.tiles.filter((t) => !t.inView && holders.get(t.item) > 1).sort((a, b) => far(a) - far(b))[0];
      if (!tile) return;
      this.give(tile, item);
    }
    // Straight to the spring targets (not push(): a focus jump may be longer than the scroll's maxLead).
    this.scrolled.x.target += (this.vp.width / 2 - (tile.x + tile.w / 2)) / tile.pace;
    this.scrolled.y.target += (this.vp.height / 2 - (tile.y + tile.h / 2)) / tile.pace;
  }
}
