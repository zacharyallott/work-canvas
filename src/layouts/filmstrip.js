import { Layout } from '../core/layout.js';
import { ARTBOARD } from '../core/defaults.js';

/**
 * Version A — Horizontal filmstrip (Figma frame 46, node 1542:5556)
 *
 * One row of 400px tiles, 18px gaps, bottom-aligned 14px above the bottom
 * edge so the tops form a skyline (heights come from each piece's real aspect
 * ratio). Bleeds off both sides and loops forever.
 *
 * Motion: the cursor steers the drift. Left of centre → the strip drifts
 * right; right of centre → it drifts left. Speed grows with distance from
 * the centre (small dead zone in the middle). The speed eases toward its
 * target, so there's a little lag. Without a cursor (touch, or pointer
 * outside the header) it drifts slowly left; on touch you can also swipe.
 * Speed bends the tiles slightly. Hover reveals the title.
 */
export const config = {
  // Layout (design px at the 1280×794 artboard; scaled by mount height)
  tileWidth: 400,
  gap: 18,
  minHeight: 250,
  maxHeight: 516,
  bottomInset: 14,
  startOffset: -162,
  minScale: 0.55,
  maxScale: 1.35,
  mobileTileWidth: 0.74, // max fraction of mount width a tile may take on narrow screens

  // Cursor drift
  maxSpeed: 620, // px/s with the cursor at either edge
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

  // Velocity effect
  bend: 1.1, // px of bend per px/frame of speed
  maxBend: 38,

  // Hover: no lens, no RGB split — hover only brings in the title
  hover: { distortion: 0, zoom: 0, speed: 7 },

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
    this.speed = 0; // smoothed px per 60fps frame (drives the bend)
  }

  resize(vp) {
    const c = this.config;
    const s = Math.min(c.maxScale, Math.max(c.minScale, vp.height / ARTBOARD.height));
    this.s = s;
    this.engine.scale = s;
    this.tileW = Math.min(c.tileWidth * s, vp.width * c.mobileTileWidth);
    this.gapPx = c.gap * s;
    this.pitch = this.tileW + this.gapPx;
    this.bottom = vp.height - c.bottomInset * s;

    // Enough tiles that the loop never shows a seam.
    const needed = Math.ceil((vp.width + this.pitch * 3) / this.pitch);
    const count = Math.max(this.items.length, needed);
    if (count !== this.tiles.length) {
      this.tiles.forEach((t) => t.dispose());
      this.makeTiles(this.repeatItems(count));
    }
    this.length = this.tiles.length * this.pitch;
    const k = this.tileW / c.tileWidth;
    for (const t of this.tiles) {
      t.w = this.tileW;
      t.h = Math.min(c.maxHeight * k, Math.max(c.minHeight * k, this.tileW / t.item.aspect));
    }
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
    const prev = this.offset;
    this.offset += (this.target - this.offset) * (1 - Math.pow(1 - c.ease, dt * 60));
    const v = (this.offset - prev) / Math.max(dt, 1e-4) / 60;
    this.speed += (v - this.speed) * Math.min(1, dt * 10);
    const bend = Math.max(-c.maxBend, Math.min(c.maxBend, this.speed * c.bend)) * this.s;

    let featured = null;
    let bestD = Infinity;
    const cx = this.vp.width / 2;
    const L = this.length;

    this.tiles.forEach((t, i) => {
      const raw = c.startOffset * this.s + i * this.pitch + this.offset;
      t.x = ((((raw + this.pitch) % L) + L) % L) - this.pitch; // wrap into [-pitch, L - pitch)
      t.y = this.bottom - t.h;
      t.w = this.tileW;
      t.z = 0;
      t.alpha = 1;
      t.reveal = 1;
      t.bend = bend;
      t.shift = 0;

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
