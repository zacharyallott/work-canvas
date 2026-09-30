import { Layout } from '../core/layout.js';
import { ARTBOARD } from '../core/defaults.js';
import { Spring } from '../core/spring.js';
import { sizePattern } from '../core/sizing.js';

/**
 * Version E — Universe (Figma frames 1613:69 desktop, 1613:93 full grid)
 *
 * A field of tiles that runs well past the view in every direction. The
 * positions are the sketch's 28 places across a 4269 × 2605 design-px field,
 * repeated side by side as many times as the collection needs (one piece per
 * place) and wrapped both ways, so it never runs out. No image shows twice in
 * a view: each piece has one place, and if the collection is too small to
 * fill every repeat, a place reuses the piece from the same place in the
 * first repeat — a whole field width away, in the same layer, so the two
 * copies move together and never meet on screen. Tiles are 400 design px wide with their
 * height from the piece's real aspect ratio.
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
  spacing: 0.64, // the places (and the field) are drawn this much closer together than the sketch — denser; tiles keep their size
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
  }

  resize(vp) {
    const c = this.config;
    const s = Math.min(c.maxScale, Math.max(c.minScale, vp.height / ARTBOARD.height));
    this.s = s;
    this.engine.scale = s;
    const n = c.places.length;
    const items = this.items;
    const base = Math.min(c.tileWidth * s, vp.width * c.mobileMaxWidth);
    const d = c.spacing * s; // design px of the field → CSS px on screen
    // Repeats: side by side, enough for every piece to have a place; a second row only if the view is taller than
    // one field can cover once the tiles wrap (very tall screens).
    const tallest = (base * Math.max(...c.layers.scale)) / c.minAspect;
    const kx = Math.max(1, Math.ceil(items.length / n));
    const ky = c.field.height * d - tallest < vp.height ? 2 : 1;
    const count = n * kx * ky;
    if (count !== this.tiles.length) {
      this.tiles.forEach((t) => t.dispose());
      // One piece per place; past the end of the collection, reuse the piece at the same place in the first
      // repeat (a whole field away, same layer, same pace) so a repeat never shares a view with its original.
      this.makeTiles(Array.from({ length: count }, (_, i) => items[i < items.length ? i : (i % n) % items.length]));
    }
    const layerOf = sizePattern(n, c.layers.pace.length, c.seed); // per place, so each repeat keeps the same depth
    this.period = { x: c.field.width * kx * d, y: c.field.height * ky * d };
    let maxW = 0;
    let maxH = 0;
    this.tiles.forEach((t, i) => {
      const p = i % n;
      const copy = Math.floor(i / n);
      const [left, top, h] = c.places[p];
      t.layer = layerOf[p];
      t.pace = c.layers.pace[t.layer];
      const aspect = Math.min(c.maxAspect, Math.max(c.minAspect, t.item.aspect || 1));
      t.w = base * c.layers.scale[t.layer];
      t.h = t.w / aspect;
      // Centre in the field (design px → CSS px), in its repeat.
      t.fx = (left + 200 + (copy % kx) * c.field.width) * d;
      t.fy = (top + h / 2 + Math.floor(copy / kx) * c.field.height) * d;
      maxW = Math.max(maxW, t.w);
      maxH = Math.max(maxH, t.h);
    });
    this.margin = { x: maxW, y: maxH }; // tiles wrap once they're fully off screen
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
    const ox = c.start.x * c.spacing * this.s + this.pan.x + this.scrolled.x.update(dt);
    const oy = c.start.y * c.spacing * this.s + this.pan.y + this.scrolled.y.update(dt);

    const { x: Px, y: Py } = this.period;
    const { x: mx, y: my } = this.margin;
    const wrap = (v, period, m) => ((((v + m) % period) + period) % period) - m; // into [-m, period - m)
    let featured = null;
    let bestScore = 0;

    this.tiles.forEach((t, i) => {
      const cx = wrap(t.fx + ox * t.pace, Px, mx);
      const cy = wrap(t.fy + oy * t.pace, Py, my);
      t.x = cx - t.w / 2;
      t.y = cy - t.h / 2;
      t.z = t.layer * 1000 + i; // back → front
      t.rotation = 0;
      t.alpha = 1;
      t.reveal = 1;
      const visible = t.x + t.w > 0 && t.x < width && t.y + t.h > 0 && t.y < height;
      t.priority = visible ? this.centerScore(t) : 0;
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
    const tile = this.tileForItem(item) ?? this.tiles.find((t) => t.item === item);
    if (!tile) return;
    // Straight to the spring targets (not push(): a focus jump may be longer than the scroll's maxLead).
    this.scrolled.x.target += (this.vp.width / 2 - (tile.x + tile.w / 2)) / tile.pace;
    this.scrolled.y.target += (this.vp.height / 2 - (tile.y + tile.h / 2)) / tile.pace;
  }
}
