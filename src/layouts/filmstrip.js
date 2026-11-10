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
 * spring, so each scroll eases in and out. The two rows always run in
 * opposite directions (`rowDirections`): the upper row as described, the lower
 * one mirrored — for the cursor, the idle drift, scrolling and swipes alike.
 * The faster a row moves (drift, scroll or swipe), the wider the gaps between
 * its tiles: the extra spacing follows the speed through a spring, so it
 * opens with a slight lag and settles back as the row slows, like something
 * with weight. It spreads from the centre of the view, so the middle stays put.
 * Tiles stay flat (no warp or distortion). Hover reveals the title.
 *
 * On a screen taller than it is wide (a phone held upright) the strip stands
 * up (`vertical`): the two rows become two columns side by side, meeting along
 * a gutter down the middle with their uneven edges facing out, and they run up
 * and down — the same motion turned a quarter: scroll or swipe up to go
 * forward, the left column as the upper row, the right one mirrored.
 */
export const config = {
  // Layout (design px at the 1280×794 artboard; scaled by mount height)
  // Size scale: each tile picks one of these heights (seeded, never the same as
  // its neighbour). Width = height × the image's aspect ratio.
  heights: [215, 250, 290, 340, 405],
  minWidth: 205, // narrower pieces get taller instead (keeps the aspect ratio)
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
  // Upright screens: two columns. Each tile takes a width from `widths` (fractions of a column's room, never the
  // same as its neighbour) and its height from the piece's aspect ratio, held between `minHeight` and
  // `maxHeight` (fractions of the column's room; taller pieces are cropped). `inset` = CSS px from the side edges.
  vertical: { widths: [0.72, 0.8, 0.88, 0.94, 1], minHeight: 0.45, maxHeight: 1.6, inset: 12 },

  // Cursor drift
  maxSpeed: 115, // px/s with the cursor at either edge
  deadZone: 0.06, // fraction of the half-width around the centre with no drift
  curve: 1.7, // >1 = gentle near the centre, quick toward the edges
  response: 2.2, // how fast the speed follows the cursor (higher = less lag)
  idleSpeed: 24, // px/s leftward drift with no cursor over the header (0 = still)
  hoverSlowdown: 1, // speed multiplier while a tile is hovered (1 = no slowdown)
  rowBoost: 1.25, // the row the cursor is over drifts this much faster than the other
  rowDirections: [-1, 1], // lower, upper: 1 moves as the cursor / scroll / swipe says, -1 the opposite way

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
  hover: { zoom: 0, speed: 7, expand: 8 }, // a project tile's frame opens up on hover: 8px out to each side and away from the rows' gutter (up in the upper row, down in the lower; tile.js); its neighbours make room

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
    this.rows = Array.from({ length: ROWS }, (_, r) => {
      const dir = cfg.rowDirections?.[r] ?? 1;
      return {
        tiles: [],
        offset: 0,
        target: 0,
        dir, // this row's way round (rowDirections)
        drift: -cfg.idleSpeed * dir, // px/s, eased toward the cursor-derived speed
        spread: new Spread(cfg.spread), // extra px per gap, following this row's speed
      };
    });
  }

  resize(vp) {
    const c = this.config;
    const s = Math.min(c.maxScale, Math.max(c.minScale, vp.height / ARTBOARD.height));
    this.s = s;
    this.engine.scale = s;
    this.gapPx = c.gap;
    const vertical = (this.vertical = Boolean(c.vertical) && vp.height > vp.width);
    // A tile's size from its piece and its step on the size scale; and how much room a tile can take along the strip.
    let fit;
    let steps;
    let longest;
    if (vertical) {
      // Two columns meeting at the middle: each has half the width, less the side insets and the gutter.
      const v = c.vertical;
      const room = (vp.width - 2 * v.inset - c.gap) / ROWS;
      const minH = room * v.minHeight;
      const maxH = room * v.maxHeight;
      steps = v.widths.map((f) => f * room);
      fit = (aspect, width) => {
        let w = width;
        let h = w / aspect;
        if (h < minH) {
          w = Math.min(room, minH * aspect); // wide pieces get wider instead (up to the column's room)
          h = w / aspect;
        }
        return { w, h: Math.min(h, maxH) }; // tall pieces: crop (cover) rather than tower
      };
      longest = maxH;
    } else {
      // Both rows fit between the top bar and the bottom inset: scale the size scale down if they wouldn't.
      const rowRoom = (vp.height - c.topInset * s - c.bottomInset - c.gap) / ROWS;
      const k = Math.min(1, rowRoom / (Math.max(...c.heights) * s));
      const maxW = Math.min(c.maxWidth * s * k, vp.width * c.mobileMaxWidth);
      const minW = Math.min(c.minWidth * s * k, maxW);
      const maxH = Math.max(...c.heights) * s * k;
      steps = c.heights.map((h) => h * s * k);
      fit = (aspect, height) => fitSize(aspect, height, { minW, maxW, maxH });
      longest = maxW;
      this.rowHeight = maxH;
    }
    const along = (size) => (vertical ? size.h : size.w);
    const span = vertical ? vp.height : vp.width;

    // Each row: every other piece. It loops, so it must reach past both sides of the view. One pass of its pieces
    // nearly always does; when it doesn't (few pieces, very wide screens) it repeats them in whole passes — never a
    // partial one, which put a piece's copy right beside it where the loop joins (the same piece twice on screen).
    const rowItems = Array.from({ length: ROWS }, (_, r) => this.items.filter((_, i) => i % ROWS === r));
    const reach = span + 2 * (longest + this.gapPx);
    const counts = rowItems.map((items, r) => {
      if (!items.length) return 0;
      const pattern = sizePattern(items.length, steps.length, c.seed + r);
      const pass = items.reduce((x, item, i) => x + along(fit(item.aspect, steps[pattern[i]])) + this.gapPx, 0);
      return items.length * Math.max(1, Math.ceil(reach / pass));
    });
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

    // Size each tile: pick a step from the scale (a height across rows, a width down columns), derive the other
    // side from the aspect ratio, and if that's out of bounds adjust the step instead.
    this.rows.forEach((row, r) => {
      const pattern = sizePattern(row.tiles.length, steps.length, c.seed + r);
      let x = 0;
      row.tiles.forEach((t, i) => {
        const size = fit(t.item.aspect, steps[pattern[i]]);
        t.w = size.w;
        t.h = size.h;
        t.baseX = x; // along the strip (down a column when upright)
        x += along(size) + this.gapPx;
      });
      row.length = x;
      if (!vertical) {
        // The rows meet along an even gutter: the lower row hangs from a line `gap` below the line the upper row stands on.
        row.top = vp.height - c.bottomInset - this.rowHeight; // lower row: tiles hang from here
        row.bottom = row.top - c.gap; // upper row: tiles stand on this line
      }
      row.start = c.startOffset * s - r * c.rowStagger * (x / Math.max(1, row.tiles.length));
    });
    this.gutter = vp.width / 2; // upright: the columns meet here
    this.margin = longest + this.gapPx; // wrap margin so tiles leave/enter fully off-screen
  }

  /** Target drift speed (px/s) for the current cursor position, for row `r` (0 = lower, 1 = upper). */
  targetDrift(r) {
    const c = this.config;
    const { nx, ny, inside } = this.engine.cursor;
    if (!inside) return this.reduced ? 0 : -c.idleSpeed * this.s;
    // Along the strip: across for rows, up and down for columns.
    const n = this.vertical ? ny : nx;
    const mag = Math.max(0, (Math.abs(n) - c.deadZone) / (1 - c.deadZone));
    const hovering = this.engine.hovered && this.tiles.includes(this.engine.hovered);
    // The row the cursor is over runs a little faster: above the upper row's line is the upper row (upright: left
    // of the gutter is the left column, which plays the upper row).
    const over = this.vertical ? (((nx + 1) / 2) * this.vp.width < this.gutter ? 1 : 0) : ((ny + 1) / 2) * this.vp.height < this.rows[1].bottom + c.gap / 2 ? 1 : 0;
    const boost = r === over ? c.rowBoost : 1;
    // Cursor left (nx < 0) → positive speed → strip moves right (upright: cursor high → it moves down).
    return -Math.sign(n) * Math.pow(mag, c.curve) * c.maxSpeed * this.s * boost * (hovering ? c.hoverSlowdown : 1);
  }

  update(dt) {
    const c = this.config;
    const scrolled = this.scrolled.update(dt);
    this.velocity *= Math.pow(c.inertia, dt * 60);
    const V = this.vertical;
    const axis = V ? 'y' : 'x'; // along the strip
    const size = V ? 'h' : 'w';
    const span = V ? this.vp.height : this.vp.width;
    const cx = span / 2; // the middle of the view, along the strip
    const m = this.margin;
    let featured = null;
    let bestD = Infinity;

    this.rows.forEach((row, r) => {
      row.drift += (this.targetDrift(r) * row.dir - row.drift) * (1 - Math.exp(-dt * c.response));
      row.target += (row.drift + this.velocity * row.dir) * dt;
      row.offset += (row.target - row.offset) * (1 - Math.pow(1 - c.ease, dt * 60));

      // How fast the row is actually moving → how much extra gap, eased (the lag gives it weight).
      const pos = row.offset + scrolled * row.dir;
      const extra = row.spread.update(pos, dt, this.reduced);
      const L = row.length;
      row.tiles.forEach((t) => {
        const raw = row.start + t.baseX + pos;
        t[axis] = ((((raw + m) % L) + L) % L) - m; // wrap into [-margin, L - margin)
      });
      spreadFrom(row.tiles, axis, this.gapPx, extra, cx);
      // A project tile opening up on hover (tile.js) grows `expand` px to each side: the tiles before and after it
      // move over by as much, so the gaps stay even.
      const grow = this.reduced || this.engine.touch ? 0 : c.hover.expand ?? 0;
      if (grow) {
        for (const j of row.tiles) {
          const push = j.item.caseStudy ? grow * j.hover : 0;
          if (push < 0.01) continue;
          const mid = j[axis] + j[size] / 2;
          for (const t of row.tiles) if (t !== j) t[axis] += t[axis] + t[size] / 2 < mid ? -push : push;
        }
      }

      row.tiles.forEach((t) => {
        if (V) {
          t.x = r ? this.gutter - this.gapPx / 2 - t.w : this.gutter + this.gapPx / 2; // the columns meet at the gutter
          t.expandDir = null;
        } else {
          t.y = r ? row.bottom - t.h : row.top;
          t.expandDir = r ? 'up' : 'down'; // opening up on hover: away from the gutter between the rows
        }
        t.z = 0;
        t.alpha = 1;
        t.reveal = 1;
        const visible = t[axis] + t[size] > 0 && t[axis] < span;
        const d = Math.abs(t[axis] + t[size] / 2 - cx) + r; // the lower row wins ties
        if (visible && d < bestD) {
          bestD = d;
          featured = t;
        }
        t.priority = visible ? this.centerScore(t) : 0;
        this.applyTransition(t, Math.min(1, Math.max(0, t[axis] / span)));
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
    for (const row of this.rows) row.target += (dx + dy) * this.config.dragMultiplier * row.dir;
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
    if (!row) return;
    row.target += this.vertical ? this.vp.height / 2 - (tile.y + tile.h / 2) : this.vp.width / 2 - (tile.x + tile.w / 2);
  }
}
