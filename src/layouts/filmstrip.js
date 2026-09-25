import { Layout } from '../core/layout.js';
import { ARTBOARD } from '../core/defaults.js';
import { sizePattern, fitSize } from '../core/sizing.js';

/**
 * Version A — Horizontal filmstrip (Figma frame 46, node 1542:5556)
 *
 * One row of tiles, 12px gaps, bottom-aligned 12px above the bottom edge so
 * the tops form a skyline. Each tile takes a height from a size scale (no two
 * neighbours the same) and its width follows from the piece's real aspect
 * ratio, so both dimensions vary without cropping. Bleeds off both sides and
 * loops forever.
 *
 * Motion: the cursor steers the drift. Left of centre → the strip drifts
 * right; right of centre → it drifts left. Speed grows with distance from
 * the centre (small dead zone in the middle). The speed eases toward its
 * target, so there's a little lag. Without a cursor (touch, or pointer
 * outside the header) it drifts slowly left; on touch you can also swipe.
 * Tiles stay flat (no warp or distortion). Hover reveals the title.
 */
export const config = {
  // Layout (design px at the 1280×794 artboard; scaled by mount height)
  // Size scale: each tile picks one of these heights (seeded, never the same as
  // its neighbour). Width = height × the image's aspect ratio.
  heights: [210, 280, 360, 440, 540],
  minWidth: 190, // narrower pieces get taller instead (keeps the aspect ratio)
  maxWidth: 760, // wider pieces get shorter instead
  gap: 12, // CSS px between tiles (fixed, not scaled with the viewport)
  bottomInset: 12, // CSS px from the bottom edge (fixed)
  startOffset: -162,
  minScale: 0.55,
  maxScale: 1.35,
  mobileMaxWidth: 0.82, // max fraction of mount width a tile may take on narrow screens
  seed: 7, // change to reshuffle the size pattern

  // Cursor drift
  maxSpeed: 480, // px/s with the cursor at either edge
  deadZone: 0.06, // fraction of the half-width around the centre with no drift
  curve: 1.7, // >1 = gentle near the centre, quick toward the edges
  response: 2.2, // how fast the speed follows the cursor (higher = less lag)
  idleSpeed: 24, // px/s leftward drift with no cursor over the header (0 = still)
  hoverSlowdown: 1, // speed multiplier while a tile is hovered (1 = no slowdown)

  // Touch swipe (no cursor on touch devices)
  dragMultiplier: 1.15,
  throw: 0.9,
  inertia: 0.94, // velocity kept per 1/60 s
  ease: 0.12, // position smoothing per 1/60 s

  // Hover only brings in the title (zoom 0 = the image doesn't move)
  hover: { zoom: 0, speed: 7 },

  // Media
  maxVideos: 4,

  // Transitions
  easing: 'expo.out',
  stagger: 0.55,
  enterDuration: 1.5,
  leaveDuration: 0.8,
  captionInset: [20, 12],
};

export default class Filmstrip extends Layout {
  static defaults = config;
  static label = 'Filmstrip';

  constructor(engine, cfg) {
    super(engine, cfg);
    this.offset = 0;
    this.target = 0;
    this.drift = -cfg.idleSpeed; // px/s, eased toward the cursor-derived speed
    this.velocity = 0; // px/s from touch throws
  }

  resize(vp) {
    const c = this.config;
    const s = Math.min(c.maxScale, Math.max(c.minScale, vp.height / ARTBOARD.height));
    this.s = s;
    this.engine.scale = s;
    this.gapPx = c.gap;
    this.bottom = vp.height - c.bottomInset;
    const maxW = Math.min(c.maxWidth * s, vp.width * c.mobileMaxWidth);
    const minW = Math.min(c.minWidth * s, maxW);
    const maxH = Math.max(...c.heights) * s;

    // Enough tiles that the loop never shows a seam (estimate with the smallest tiles).
    const needed = Math.ceil((vp.width + maxW * 3) / (minW + this.gapPx));
    const count = Math.max(this.items.length, needed);
    if (count !== this.tiles.length) {
      this.tiles.forEach((t) => t.dispose());
      this.makeTiles(this.repeatItems(count));
    }

    // Size each tile: pick a height from the scale, derive the width from the
    // aspect ratio, and if that's too wide/narrow adjust the height instead.
    const pattern = sizePattern(this.tiles.length, c.heights.length, c.seed);
    let x = 0;
    this.tiles.forEach((t, i) => {
      const { w, h } = fitSize(t.item.aspect, c.heights[pattern[i]] * s, { minW, maxW, maxH });
      t.w = w;
      t.h = h;
      t.baseX = x;
      x += w + this.gapPx;
    });
    this.length = x;
    this.margin = maxW + this.gapPx; // wrap margin so tiles leave/enter fully off-screen
  }

  /** Target drift speed (px/s) for the current cursor position. */
  targetDrift() {
    const c = this.config;
    const { nx, inside } = this.engine.cursor;
    if (!inside) return this.reduced ? 0 : -c.idleSpeed * this.s;
    const mag = Math.max(0, (Math.abs(nx) - c.deadZone) / (1 - c.deadZone));
    const hovering = this.engine.hovered && this.tiles.includes(this.engine.hovered);
    // Cursor left (nx < 0) → positive speed → strip moves right.
    return -Math.sign(nx) * Math.pow(mag, c.curve) * c.maxSpeed * this.s * (hovering ? c.hoverSlowdown : 1);
  }

  update(dt) {
    const c = this.config;
    this.drift += (this.targetDrift() - this.drift) * (1 - Math.exp(-dt * c.response));

    this.target += (this.drift + this.velocity) * dt;
    this.velocity *= Math.pow(c.inertia, dt * 60);
    this.offset += (this.target - this.offset) * (1 - Math.pow(1 - c.ease, dt * 60));

    let featured = null;
    let bestD = Infinity;
    const cx = this.vp.width / 2;
    const L = this.length;

    this.tiles.forEach((t, i) => {
      const raw = c.startOffset * this.s + t.baseX + this.offset;
      const m = this.margin;
      t.x = ((((raw + m) % L) + L) % L) - m; // wrap into [-margin, L - margin)
      t.y = this.bottom - t.h;
      t.z = 0;
      t.alpha = 1;
      t.reveal = 1;

      const visible = t.x + t.w > 0 && t.x < this.vp.width;
      const d = Math.abs(t.x + t.w / 2 - cx);
      if (visible && d < bestD) {
        bestD = d;
        featured = t;
      }
      t.priority = visible ? this.centerScore(t) : 0;
      this.applyTransition(t, Math.min(1, Math.max(0, t.x / this.vp.width)), { y: t.h * 0.35 });
    });

    // "featured" only steers video priority now (no caption without hover).
    this.featured = featured;
    if (featured) featured.priority = 2;
    if (this.engine.hovered && this.tiles.includes(this.engine.hovered)) this.engine.hovered.priority = 3;
  }

  // Touch swipe only — on desktop the cursor steers.
  onDrag({ dx }) {
    if (!this.engine.isMobile) return;
    this.target += dx * this.config.dragMultiplier;
    this.velocity = 0;
  }

  onRelease({ vx }) {
    if (!this.engine.isMobile) return;
    this.velocity = vx * this.config.dragMultiplier * this.config.throw;
  }

  /** Keyboard focus: glide the nearest copy of the item to the centre. */
  focusItem(item) {
    const tile = this.tileForItem(item) ?? this.tiles.find((t) => t.item === item);
    if (tile) this.target += this.vp.width / 2 - (tile.x + tile.w / 2);
  }
}
