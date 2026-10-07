import { Layout } from '../core/layout.js';
import { ARTBOARD } from '../core/defaults.js';
import { sizePattern, fitSize } from '../core/sizing.js';
import { Spring } from '../core/spring.js';
import { Spread, spreadFrom } from '../core/spread.js';

/**
 * Version A — Horizontal filmstrip (Figma frame 46, node 1542:5556)
 *
 * Two rows of tiles, one above the other, 12px gaps — between the rows too:
 * the upper row stands on a line and the lower row hangs from a line 12px
 * below it, so the rows meet along an even gutter and their uneven edges face
 * out (the upper row's tops form a skyline under the top bar; the lower row's
 * bottoms reach to 12px above the bottom edge at most). The pieces alternate
 * between the rows. Each tile takes a height from a size
 * scale (no two neighbours the same; scaled so both rows fit under the top
 * bar) and its width follows from the piece's real aspect ratio, so both
 * dimensions vary without cropping. Each row bleeds off both sides and loops
 * forever.
 *
 * Motion: the cursor steers the drift of both rows. Left of centre → they
 * drift right; right of centre → they drift left. Speed grows with distance
 * from the centre (small dead zone in the middle) and eases toward its target,
 * so there's a little lag. The row the cursor is over runs a little faster
 * than the other (`rowBoost`), so the two slide past each other. Without a
 * cursor (touch, or pointer outside the header) they drift slowly left; on
 * touch you can also swipe. Scrolling (wheel / trackpad, or a vertical swipe
 * on touch) moves both rows along too — scroll down to go forward — through a
 * spring, so each scroll eases in and out.
 * The faster a row moves (drift, scroll or swipe), the wider the gaps between
 * its tiles: the extra spacing follows the speed through a spring, so it
 * opens with a slight lag and settles back as the row slows, like something
 * with weight. It spreads from the centre of the view, so the middle stays put.
 * Tiles stay flat (no warp or distortion). Hover reveals the title.
 */
export const config = {
  // Layout (design px at the 1280×794 artboard; scaled by mount height)
  // Size scale: each tile picks one of these heights (seeded, never the same as
  // its neighbour). Width = height × the image's aspect ratio.
  heights: [158, 210, 270, 330, 405],
  minWidth: 143, // narrower pieces get taller instead (keeps the aspect ratio)
  maxWidth: 570, // wider pieces get shorter instead
  gap: 12, // CSS px between tiles, and between the two rows (fixed, not scaled with the viewport)
  bottomInset: 12, // CSS px from the bottom edge (fixed)
  topInset: 48, // design px kept clear for the top bar: the rows (and the size scale) shrink to fit below it
  startOffset: -162,
  rowStagger: 0.45, // the upper row starts this fraction of a typical tile along, so the rows don't line up
  minScale: 0.55,
  maxScale: 1.35,
  mobileMaxWidth: 1, // max fraction of mount width a tile may take on narrow screens (phones: up to full width, you drag through them)
  seed: 7, // change to reshuffle the size pattern

  // Cursor drift
  maxSpeed: 170, // px/s with the cursor at either edge
  deadZone: 0.06, // fraction of the half-width around the centre with no drift
  curve: 1.7, // >1 = gentle near the centre, quick toward the edges
  response: 2.2, // how fast the speed follows the cursor (higher = less lag)
  idleSpeed: 24, // px/s leftward drift with no cursor over the header (0 = still)
  hoverSlowdown: 1, // speed multiplier while a tile is hovered (1 = no slowdown)
  rowBoost: 1.25, // the row the cursor is over drifts this much faster than the other

  // Scroll: wheel / trackpad (either axis) moves both rows; eased by a spring
  // px of strip per px scrolled; spring pace (1/s, higher = settles sooner after the scroll stops);
  // how far (px) the strip can lag behind the scroll — caps a big flick's speed and how long it runs on.
  // (While scrolling steadily, top speed ≈ omega × maxLead / 2 ≈ 440 px/s.)
  scroll: { multiplier: 0.5, omega: 7, maxLead: 125 },

  // Speed → spacing (spread.js), per row: extra gap (CSS px) per px/s of row speed above `rest` (the idle drift),
  // capped at `max`; opens with a lag (`omega`, 1/s) and closes sooner (`closing`) — back to normal before the pace is.
  spread: { gain: 0.016, max: 18, rest: 60, omega: 4, closing: 18 },

  // Touch swipe (no cursor on touch devices)
  dragMultiplier: 1.15,
  throw: 0.9,
  inertia: 0.94, // velocity kept per 1/60 s
  ease: 0.12, // position smoothing per 1/60 s

  // Hover only brings in the title (zoom 0 = the image doesn't move)
  hover: { zoom: 0, speed: 7 },

  // Media
  maxVideos: 4,

  // Transitions (tiles dissolve in left to right, and out all at once)
  easing: 'none',
  stagger: 0.3,
  enterDuration: 0.8,
  leaveDuration: 0.25,
  captionInset: [20, 12],
};

const ROWS = 2; // [lower, upper]

export default class Filmstrip extends Layout {
  static defaults = config;
  static label = 'Filmstrip';

  constructor(engine, cfg) {
    super(engine, cfg);
    this.velocity = 0; // px/s from touch throws (both rows)
    this.scrolled = new Spring(cfg.scroll.omega, { maxLead: cfg.scroll.maxLead }); // offset from scrolling, eased (both rows)
    this.rows = Array.from({ length: ROWS }, () => ({
      tiles: [],
      offset: 0,
      target: 0,
      drift: -cfg.idleSpeed, // px/s, eased toward the cursor-derived speed
      spread: new Spread(cfg.spread), // extra px per gap, following this row's speed
    }));
  }

  resize(vp) {
    const c = this.config;
    const s = Math.min(c.maxScale, Math.max(c.minScale, vp.height / ARTBOARD.height));
    this.s = s;
    this.engine.scale = s;
    this.gapPx = c.gap;
    // Both rows fit between the top bar and the bottom inset: scale the size scale down if they wouldn't.
    const rowRoom = (vp.height - c.topInset * s - c.bottomInset - c.gap) / ROWS;
    const k = Math.min(1, rowRoom / (Math.max(...c.heights) * s));
    const maxW = Math.min(c.maxWidth * s * k, vp.width * c.mobileMaxWidth);
    const minW = Math.min(c.minWidth * s * k, maxW);
    const maxH = Math.max(...c.heights) * s * k;
    this.rowHeight = maxH;

    // Each row: every other piece, repeated until the loop never shows a seam (estimated with the smallest tiles).
    const needed = Math.ceil((vp.width + maxW * 3) / (minW + this.gapPx));
    const rowItems = Array.from({ length: ROWS }, (_, r) => this.items.filter((_, i) => i % ROWS === r));
    const counts = rowItems.map((items) => (items.length ? Math.max(items.length, needed) : 0));
    if (counts.some((n, r) => n !== this.rows[r].tiles.length)) {
      this.tiles.forEach((t) => t.dispose());
      const all = rowItems.flatMap((items, r) => {
        const out = [];
        while (items.length && out.length < counts[r]) out.push(...items);
        return out.slice(0, counts[r]);
      });
      this.makeTiles(all);
      let i = 0;
      this.rows.forEach((row, r) => {
        row.tiles = this.tiles.slice(i, i + counts[r]);
        i += counts[r];
      });
    }

    // Size each tile: pick a height from the scale, derive the width from the
    // aspect ratio, and if that's too wide/narrow adjust the height instead.
    this.rows.forEach((row, r) => {
      const pattern = sizePattern(row.tiles.length, c.heights.length, c.seed + r);
      let x = 0;
      row.tiles.forEach((t, i) => {
        const { w, h } = fitSize(t.item.aspect, c.heights[pattern[i]] * s * k, { minW, maxW, maxH });
        t.w = w;
        t.h = h;
        t.baseX = x;
        x += w + this.gapPx;
      });
      row.length = x;
      // The rows meet along an even gutter: the lower row hangs from a line `gap` below the line the upper row stands on.
      row.top = vp.height - c.bottomInset - maxH; // lower row: tiles hang from here
      row.bottom = row.top - c.gap; // upper row: tiles stand on this line
      row.start = c.startOffset * s - r * c.rowStagger * (x / Math.max(1, row.tiles.length));
    });
    this.margin = maxW + this.gapPx; // wrap margin so tiles leave/enter fully off-screen
  }

  /** Target drift speed (px/s) for the current cursor position, for row `r` (0 = lower, 1 = upper). */
  targetDrift(r) {
    const c = this.config;
    const { nx, ny, inside } = this.engine.cursor;
    if (!inside) return this.reduced ? 0 : -c.idleSpeed * this.s;
    const mag = Math.max(0, (Math.abs(nx) - c.deadZone) / (1 - c.deadZone));
    const hovering = this.engine.hovered && this.tiles.includes(this.engine.hovered);
    // The row the cursor is over runs a little faster: above the upper row's line is the upper row.
    const y = ((ny + 1) / 2) * this.vp.height;
    const over = y < this.rows[1].bottom + c.gap / 2 ? 1 : 0;
    const boost = r === over ? c.rowBoost : 1;
    // Cursor left (nx < 0) → positive speed → strip moves right.
    return -Math.sign(nx) * Math.pow(mag, c.curve) * c.maxSpeed * this.s * boost * (hovering ? c.hoverSlowdown : 1);
  }

  update(dt) {
    const c = this.config;
    const scrolled = this.scrolled.update(dt);
    this.velocity *= Math.pow(c.inertia, dt * 60);
    const cx = this.vp.width / 2;
    const m = this.margin;
    let featured = null;
    let bestD = Infinity;

    this.rows.forEach((row, r) => {
      row.drift += (this.targetDrift(r) - row.drift) * (1 - Math.exp(-dt * c.response));
      row.target += (row.drift + this.velocity) * dt;
      row.offset += (row.target - row.offset) * (1 - Math.pow(1 - c.ease, dt * 60));

      // How fast the row is actually moving → how much extra gap, eased (the lag gives it weight).
      const pos = row.offset + scrolled;
      const extra = row.spread.update(pos, dt, this.reduced);
      const L = row.length;
      row.tiles.forEach((t) => {
        const raw = row.start + t.baseX + pos;
        t.x = ((((raw + m) % L) + L) % L) - m; // wrap into [-margin, L - margin)
      });
      spreadFrom(row.tiles, 'x', this.gapPx, extra, cx);

      row.tiles.forEach((t) => {
        t.y = r ? row.bottom - t.h : row.top;
        t.z = 0;
        t.alpha = 1;
        t.reveal = 1;
        const visible = t.x + t.w > 0 && t.x < this.vp.width;
        const d = Math.abs(t.x + t.w / 2 - cx) + r; // the lower row wins ties
        if (visible && d < bestD) {
          bestD = d;
          featured = t;
        }
        t.priority = visible ? this.centerScore(t) : 0;
        this.applyTransition(t, Math.min(1, Math.max(0, t.x / this.vp.width)));
      });
    });

    // "featured" only steers video priority now (no caption without hover).
    this.featured = featured;
    if (featured) featured.priority = 2;
    if (this.engine.hovered && this.tiles.includes(this.engine.hovered)) this.engine.hovered.priority = 3;
  }

  /** Scroll down (or right) = forward: both rows move left. */
  onWheel({ dx, dy }) {
    this.scrolled.push(-(dy + dx) * this.config.scroll.multiplier);
  }

  // Touch swipe only — on desktop the cursor steers. A vertical swipe works like scrolling (up = forward).
  onDrag({ dx, dy }) {
    if (!this.engine.touch) return;
    for (const row of this.rows) row.target += (dx + dy) * this.config.dragMultiplier;
    this.velocity = 0;
  }

  onRelease({ vx, vy }) {
    if (!this.engine.touch) return;
    this.velocity = (vx + vy) * this.config.dragMultiplier * this.config.throw;
  }

  /** Keyboard focus: glide the nearest copy of the item to the centre (its row only). */
  focusItem(item) {
    const tile = this.tileForItem(item) ?? this.tiles.find((t) => t.item === item);
    const row = tile && this.rows.find((r) => r.tiles.includes(tile));
    if (row) row.target += this.vp.width / 2 - (tile.x + tile.w / 2);
  }
}
