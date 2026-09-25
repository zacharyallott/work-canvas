import { Layout } from '../core/layout.js';
import { ARTBOARD } from '../core/defaults.js';
import { Spring } from '../core/spring.js';

/**
 * Version C — Masonry columns (Figma frame 45, node 1542:5489)
 *
 * Columns wider than the frame's 168px (212px), 12px gutters and 12px
 * vertical gaps, staggered starts (offsets from the frame), bleeding off the
 * top and bottom. Tile heights come from real aspect ratios. There are more
 * tile slots than images, so images repeat — but never within a column, and
 * where possible not within two columns either side, so copies land far apart.
 *
 * Motion: all columns drift upward on their own, each at its own pace, and
 * slow down while a tile is hovered. The whole grid shifts left/right with the
 * cursor (cursor left → grid moves right), with a little lag. Scrolling (wheel /
 * trackpad, or a vertical swipe on touch) moves the columns too — down the page
 * moves them up, back up moves them down — each at its drift pace and through
 * its own spring, so each scroll eases in and out and the columns pull apart
 * and settle one after another. Hover reveals the title. Switching
 * to it, the columns fade in where they are (left to right); nothing slides.
 */
export const config = {
  columnWidth: 212, // Figma 168, scaled up so fewer, larger tiles fill the view
  gutter: 12, // CSS px between columns (fixed, not scaled with the viewport)
  gap: 12, // CSS px between tiles in a column (fixed)
  firstColumnX: -8,
  // Top of each column's first tile in the frame (design px); repeats for extra columns.
  columnOffsets: [-381, -234, -381, -56, -257, -56, -381],
  // Relative pace per column (all move the same way), for the drift and for scrolling; repeats for extra columns.
  // Faster columns also settle a scroll sooner, slower ones lag behind.
  columnSpeeds: [1, 0.55, 1.35, 0.75, 1.15, 0.45, 0.9],
  minScale: 0.72, // column width never drops below 168 × this
  maxScale: 1.35,
  minAspect: 0.62, // taller than this gets cropped (cover)
  maxAspect: 2.2, // wider than this gets cropped

  // Vertical drift
  autoplaySpeed: 22, // px/s
  hoverSlowdown: 0.12, // speed multiplier while a tile is hovered
  hoverEase: 3, // how quickly it slows / recovers (1/s)

  // Scroll: wheel / trackpad / vertical swipe moves the columns; eased by a spring
  scroll: {
    multiplier: 0.35, // px of travel per px scrolled (swipes too), for a pace-1 column
    omega: 3, // spring pace (1/s, higher = snappier; ~4/omega s to settle)
  },

  // Horizontal shift from the cursor
  shift: {
    mode: 'offset', // 'offset' = grid leans up to `max` px toward the cursor side; 'drift' = keeps travelling (like the filmstrip)
    max: 190, // design px at the edges ('offset' mode)
    speed: 260, // design px/s at the edges ('drift' mode)
    curve: 1.3,
    response: 2.5, // lag (1/s; lower = floatier)
  },
  dimOthers: 0, // 0..1 desaturate non-hovered tiles while hovering

  hover: { zoom: 0, speed: 8 }, // hover only brings in the title (the image doesn't move)
  maxVideos: 6,

  easing: 'none',
  stagger: 0.3,
  enterDuration: 0.8,
  leaveDuration: 0.25,
  captionInset: [14, 13],
};

/** Deterministic shuffle (mulberry32) so layouts are stable across reloads. */
function shuffled(list, seed) {
  let a = seed * 0x9e3779b9;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default class Masonry extends Layout {
  static defaults = config;
  static label = 'Masonry';

  constructor(engine, cfg) {
    super(engine, cfg);
    this.scroll = 0; // vertical travel from the drift
    // Scroll travel per column pattern slot, each eased by its own spring (kept across resizes).
    this.scrollSprings = cfg.columnSpeeds.map((v) => new Spring(cfg.scroll.omega * Math.sqrt(v)));
    this.slow = 1; // eased hover slowdown multiplier
    this.shiftX = 0; // horizontal offset (px)
    this.shiftV = 0; // horizontal speed for 'drift' mode (px/s)
    this.columns = [];
  }

  resize(vp) {
    const c = this.config;
    const s = Math.min(c.maxScale, Math.max(c.minScale, vp.width / ARTBOARD.width));
    this.s = s;
    this.engine.scale = s;
    this.colW = c.columnWidth * s;
    this.pitch = c.columnWidth * s + c.gutter;
    this.gapPx = c.gap;

    // Enough columns to cover the mount plus the furthest shift on either side (and a spare to wrap).
    const reach = c.shift.mode === 'drift' ? this.pitch : c.shift.max * s;
    const colCount = Math.max(3, Math.ceil((vp.width + 2 * reach) / this.pitch) + 2);
    this.totalW = colCount * this.pitch;

    const maxH = this.colW / c.minAspect;
    const minColLength = vp.height + 2 * (maxH + this.gapPx);
    const heightOf = (item) => this.colW / Math.min(c.maxAspect, Math.max(c.minAspect, item.aspect));

    // Fill the shortest column first. Each pick is the least-used image that
    // isn't already in this column or the two either side (columns wrap, so the
    // ends are neighbours); failing that, one column either side; failing that,
    // just not this column. Ties go by a seeded shuffle, so it's stable.
    const cols = Array.from({ length: colCount }, () => ({ tiles: [], length: 0, has: new Set() }));
    const n = this.items.length;
    const rank = new Map(shuffled(this.items, 1).map((item, r) => [item, r]));
    const uses = new Map(this.items.map((item) => [item, 0]));
    const near = (ci, d) => {
      const set = new Set();
      for (let k = -d; k <= d; k++) cols[(ci + k + colCount) % colCount].has.forEach((it) => set.add(it));
      return set;
    };
    for (let k = 0; cols.some((col) => col.length < minColLength) || k < n; k++) {
      const ci = cols.reduce((a, col, i) => (col.length < cols[a].length ? i : a), 0);
      const col = cols[ci];
      const byUse = [...this.items].sort((a, b) => uses.get(a) - uses.get(b) || rank.get(a) - rank.get(b));
      const far = near(ci, 2);
      const close = near(ci, 1);
      const item = byUse.find((it) => !far.has(it)) ?? byUse.find((it) => !close.has(it)) ?? byUse.find((it) => !col.has.has(it)) ?? byUse[0];
      uses.set(item, uses.get(item) + 1);
      col.has.add(item);
      col.tiles.push({ item, h: heightOf(item) });
      col.length += heightOf(item) + this.gapPx;
      if (k > 4000) break; // safety
    }

    // Rebuild tiles only if the structure changed.
    const signature = cols.map((col) => col.tiles.map((t) => t.item.index).join('.')).join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      this.tiles.forEach((t) => t.dispose());
      this.makeTiles(cols.flatMap((col) => col.tiles.map((t) => t.item)));
    }

    // Column 0 sits one pitch left of the Figma position so shifting right never exposes a gap.
    const firstX = c.firstColumnX * s - this.pitch;
    this.origin = firstX - this.pitch; // columns wrap within [origin, origin + totalW)
    let ti = 0;
    this.columns = cols.map((col, i) => {
      let cum = 0;
      const tiles = col.tiles.map((spec) => {
        const tile = this.tiles[ti++];
        tile.w = this.colW;
        tile.h = spec.h;
        tile.offsetInCol = cum;
        cum += spec.h + this.gapPx;
        return tile;
      });
      // i - 1 so the Figma stagger pattern still starts at the first visible column.
      const len = c.columnOffsets.length;
      const p = (((i - 1) % len) + len) % len;
      const k = p % c.columnSpeeds.length;
      return { baseX: firstX + i * this.pitch, start: c.columnOffsets[p] * s, pace: c.columnSpeeds[k], spring: this.scrollSprings[k], length: cum, tiles };
    });
  }

  update(dt) {
    const c = this.config;
    const e = this.engine;
    const { width, height } = this.vp;
    const hovering = e.hovered && this.tiles.includes(e.hovered);

    // Vertical drift, eased down while hovering.
    this.slow += ((hovering ? c.hoverSlowdown : 1) - this.slow) * (1 - Math.exp(-dt * c.hoverEase));
    if (!this.reduced) this.scroll += c.autoplaySpeed * this.s * this.slow * dt;

    // Horizontal shift from the cursor (cursor left → grid moves right).
    const { nx, inside } = e.cursor;
    const pull = inside ? -Math.sign(nx) * Math.pow(Math.abs(nx), c.shift.curve) : 0;
    const r = 1 - Math.exp(-dt * c.shift.response);
    if (c.shift.mode === 'drift') {
      this.shiftV += (pull * c.shift.speed * this.s - this.shiftV) * r;
      this.shiftX += this.shiftV * dt;
    } else {
      this.shiftX += (pull * c.shift.max * this.s - this.shiftX) * r;
    }

    this.scrollSprings.forEach((sp) => sp.update(dt));
    const pad = this.colW / c.minAspect + this.gapPx; // vertical wrap margin
    const W = this.totalW;
    let featured = null;
    let bestScore = 0;

    for (const col of this.columns) {
      const x = ((((col.baseX + this.shiftX - this.origin) % W) + W) % W) + this.origin; // wrap horizontally
      const pos = col.start - (this.scroll - col.spring.x) * col.pace; // drift and scrolling down both move it up
      for (const t of col.tiles) {
        const L = col.length;
        t.x = x;
        t.y = ((((pos + t.offsetInCol + pad) % L) + L) % L) - pad;
        t.w = this.colW;
        t.z = 0;
        t.alpha = 1;
        t.reveal = 1;
        t.gray = hovering && t !== e.hovered ? c.dimOthers * (1 - this.slow) : 0;
        const visible = t.y + t.h > 0 && t.y < height && t.x + t.w > 0 && t.x < width;
        t.priority = visible ? this.centerScore(t) : 0;
        if (t.priority > bestScore) {
          bestScore = t.priority;
          featured = t;
        }
        this.applyTransition(t, Math.min(1, Math.max(0, x / width))); // fade in place, column by column
      }
    }

    // No caption without hover; "featured" only steers video priority (e.g. on touch).
    this.featured = featured;
    if (featured) featured.priority = 2;
    if (hovering) e.hovered.priority = 3;
  }

  /** Scroll down = the leading columns move up (the others, going the other way, move down). */
  onWheel({ dy }) {
    this.pushScroll(-dy);
  }

  // Touch: a vertical swipe moves the columns with the finger, then carries on a little.
  onDrag({ dy }) {
    if (this.engine.touch) this.pushScroll(dy);
  }

  onRelease({ vy }) {
    if (this.engine.touch) this.pushScroll(vy * 0.25);
  }

  pushScroll(d) {
    for (const sp of this.scrollSprings) sp.push(d * this.config.scroll.multiplier);
  }
}
