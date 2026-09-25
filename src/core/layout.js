import gsap from 'gsap';
import { Tile } from './tile.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Base class for layouts. A layout owns a list of tiles and, every frame,
 * writes their rects/looks in update(). The engine does everything else.
 *
 * Enter/leave use one `progress` value (0 hidden → 1 shown) that each tile
 * reads with its own stagger offset, so transitions keep working while the
 * layout is still moving.
 */
export class Layout {
  static defaults = {};

  constructor(engine, config) {
    this.engine = engine;
    this.config = config;
    this.tiles = [];
    this.featured = null;
    this.progress = 0;
    this.introEase = gsap.parseEase(config.easing ?? 'power3.out');
  }

  get items() {
    return this.engine.mediaItems;
  }
  get vp() {
    return this.engine.viewport;
  }
  get reduced() {
    return this.engine.reducedMotion;
  }

  makeTiles(items) {
    this.tiles = items.map((item, i) => new Tile(this.engine, item, i));
    return this.tiles;
  }

  /** Items repeated (in order) until there are at least `count`. */
  repeatItems(count) {
    const out = [];
    while (out.length < count) out.push(...this.items);
    return out.slice(0, Math.max(count, this.items.length));
  }

  // ─── Transitions ───────────────────────────────────────────────────────────
  /** Per-tile progress with stagger. `order` is 0..1 (e.g. screen x / width). */
  tileProgress(order) {
    const s = this.config.stagger ?? 0.4;
    return this.introEase(clamp01(this.progress * (1 + s) - order * s));
  }

  /**
   * Applies the shared enter/leave look to a tile whose rect is already set.
   * `fade: true` = opacity only, no movement or wipe.
   */
  applyTransition(tile, order, from = { x: 0, y: 80 }, { fade = false } = {}) {
    const p = this.tileProgress(order);
    if (p >= 1) return;
    if (this.reduced || fade) {
      tile.alpha *= p;
      return;
    }
    tile.x += (from.x ?? 0) * (1 - p);
    tile.y += (from.y ?? 0) * (1 - p);
    tile.reveal = Math.min(tile.reveal, p);
    tile.alpha *= Math.min(1, p * 4);
  }

  enter() {
    const duration = this.reduced ? 0.4 : this.config.enterDuration ?? 1.4;
    return new Promise((resolve) => gsap.fromTo(this, { progress: 0 }, { progress: 1, duration, ease: 'none', onComplete: resolve }));
  }

  leave() {
    const duration = this.reduced ? 0.3 : this.config.leaveDuration ?? 0.7;
    return new Promise((resolve) => gsap.to(this, { progress: 0, duration, ease: 'none', onComplete: resolve }));
  }

  // ─── Focus / caption ───────────────────────────────────────────────────────
  /** Captions only appear on hover (or tap on touch, or keyboard focus of a real link). */
  captionTile() {
    const { hovered, focusedItem } = this.engine;
    if (hovered && this.tiles.includes(hovered)) return hovered;
    if (focusedItem) return this.tileForItem(focusedItem);
    return null;
  }

  /** The on-screen tile showing `item` nearest the viewport centre. */
  tileForItem(item) {
    const cx = this.vp.width / 2;
    const cy = this.vp.height / 2;
    let best = null;
    let bestD = Infinity;
    for (const t of this.tiles) {
      if (t.item !== item) continue;
      const d = Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** 0..1 closeness to the viewport centre, used as video priority. */
  centerScore(tile) {
    const dx = (tile.x + tile.w / 2 - this.vp.width / 2) / this.vp.width;
    const dy = (tile.y + tile.h / 2 - this.vp.height / 2) / this.vp.height;
    return clamp01(1 - Math.hypot(dx, dy)) * 0.99 + 0.01;
  }

  resize() {}
  update() {}

  dispose() {
    gsap.killTweensOf(this);
    this.tiles.forEach((t) => t.dispose());
    this.tiles = [];
  }
}
