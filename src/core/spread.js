import { Spring } from './spring.js';

/**
 * Speed → spacing, shared by the filmstrip and masonry: the faster a row or
 * column of tiles moves, the wider its gaps. Only speed above the normal
 * drift (`rest`) counts, so at the usual pace the spacing is the original
 * one. The extra spacing opens through a soft spring (`omega`, a slight lag,
 * like something with weight) and closes through a quicker one (`closing`),
 * so it's back to the original spacing before the tiles are back to their
 * normal pace.
 */
export class Spread {
  /**
   * config: { gain: extra px per px/s above `rest`, max: cap in px, rest: px/s of normal drift (no extra),
   * omega: opening spring pace (1/s, lower = more lag), closing: closing spring pace (1/s, higher = sooner) }
   */
  constructor(config) {
    this.config = config;
    this.spring = new Spring(config.omega);
    this.last = null;
    this.speed = 0; // px/s, lightly smoothed (frame-to-frame timing is noisy)
  }

  /** Feed the current (unwrapped) position; returns the extra px per gap for this frame. */
  update(pos, dt, off = false) {
    const c = this.config;
    if (this.last != null && dt > 0) this.speed += (Math.abs(pos - this.last) / dt - this.speed) * (1 - Math.exp(-dt * 20));
    this.last = pos;
    const want = off ? 0 : Math.min(c.max, Math.max(0, this.speed - (c.rest ?? 0)) * c.gain);
    this.spring.target = want;
    this.spring.omega = want < this.spring.x ? (c.closing ?? c.omega) : c.omega;
    return Math.max(0, this.spring.update(dt));
  }
}

/**
 * Opens every gap in a looping line of tiles by `extra` px, spreading out
 * from `pivot` (a screen coordinate). Each tile moves by the number of gaps
 * between it and the pivot — fractional for the tile the pivot falls in — so
 * the spacing stays even and nothing jumps as tiles pass the pivot. `tiles`
 * must be in line order; `axis` is 'x' (a row) or 'y' (a column). The loop's
 * seam must be off screen.
 */
export function spreadFrom(tiles, axis, gap, extra, pivot) {
  if (!(extra > 0.05) || !tiles.length) return;
  const size = axis === 'x' ? 'w' : 'h';
  const pitch = (t) => t[size] + gap;
  const j = tiles.findIndex((t) => t[axis] <= pivot && pivot < t[axis] + pitch(t));
  if (j < 0) return;
  const origin = tiles[j];
  const u = (pivot - origin[axis]) / pitch(origin); // where the pivot falls in that tile + its gap, 0..1
  const n = tiles.length;
  tiles.forEach((t, i) => {
    let k = (((i - j) % n) + n) % n; // gaps after the pivot's tile…
    if (t[axis] < origin[axis]) k -= n; // …or before it
    t[axis] += (k - u + 0.5) * extra;
  });
}
