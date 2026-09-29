import { Layout } from '../core/layout.js';
import { ARTBOARD } from '../core/defaults.js';
import { Spring } from '../core/spring.js';
import { Spread } from '../core/spread.js';
import { sizePattern } from '../core/sizing.js';

/**
 * Version D — Fan (Figma frame 54, node 1601:6774)
 *
 * The tiles fan out around one point centred just below the bottom of the view (`drop`): each
 * tile's bottom-right corner points at that point (sitting `hole` px out from
 * it, so there's a gap in the middle) and each is turned 11.25° on from the
 * one before, so 32 tiles make the full circle (the lower half is below the
 * fold). With the bottom-right corner as the anchor, the tiles on the left
 * stand upright and they turn clockwise towards the right. Tiles are around 400 design px wide — each picks a size
 * from a scale, never the same as its neighbour — with their height from the
 * piece's real aspect ratio. Later (more clockwise) tiles lie on top, like a
 * hand of cards.
 *
 * It's a loop: the circle has 32 places, and as the fan turns, the place
 * passing through the hidden lower half takes the next piece in the
 * collection, so a full turn brings round new work.
 *
 * Motion: on load the tiles fade in one at a time, clockwise from the left.
 * Scrolling (wheel / trackpad, or a
 * swipe on touch) turns it slowly, eased through a spring; with nothing
 * happening it drifts round very slowly. The faster it turns, the further the
 * tiles move out from the centre point (see spread.js: it opens with a slight
 * lag and closes sooner than the turn slows). Hovering a tile brings it to the
 * front and slides it out past the others along its own direction, with its
 * title if it has a project view — set along whichever of the tile's two
 * most-horizontal edges is further from the centre point, reading left to
 * right, so it's always legible.
 */
export const config = {
  // Layout (design px at the 1280×794 artboard; scaled by mount height)
  tileWidth: 400,
  // Size variety: each tile's width is tileWidth × one of these (seeded, never the same as its neighbour).
  // Kept modest so the biggest tiles don't outgrow the loaded image (textures top out at 1280 px) on 2× screens.
  sizes: [0.76, 0.88, 1, 1.12],
  seed: 11, // change to reshuffle the sizes
  step: 11.25, // degrees between neighbouring tiles (360 / 11.25 = 32 places)
  minAspect: 0.75, // taller than this gets cropped (keeps portraits from towering)
  maxAspect: 1.8, // wider than this gets cropped
  minScale: 0.55,
  maxScale: 1.05, // with the sizes and minAspect above, the longest edge stays within a 1280 px texture at 2×
  mobileMaxWidth: 0.55, // tile width never exceeds this fraction of the view width (phones)
  seam: 225, // degrees: where places leave/join the loop — a tile turned this far is wholly below the fold
  hole: 420, // design px each tile sits out from the centre point at rest (a gap in the middle; the speed spread adds to it)
  drop: 180, // design px the centre point sits below the bottom edge of the view
  hoverOut: 56, // design px a hovered tile slides out from the others, along its own direction (eased with the hover)

  // Motion (degrees)
  idleSpeed: 0.8, // °/s clockwise drift with nothing happening (0 = still)
  // ° per px scrolled; spring pace (1/s); how far (°) the turn can lag behind the scroll — caps its top speed
  // (≈ omega × maxLead / 2 ≈ 24°/s while scrolling steadily) and how long it runs on after the scroll stops.
  scroll: { multiplier: 0.03, omega: 4, maxLead: 12 },
  dragMultiplier: 0.08, // ° per px of swipe (touch)
  throw: 0.8,
  inertia: 0.95, // swipe momentum kept per 1/60 s

  // Speed → radius: px (design, scaled) the tiles move out from the centre per °/s above `rest`, capped at `max`.
  // The same smooth response both ways (`omega` = `closing`), so the tiles draw back in step with the turn slowing
  // and are home as it settles, rather than coming in on their own afterwards.
  spread: { gain: 6, max: 230, rest: 1, omega: 11, closing: 11 },

  hover: { zoom: 0, speed: 7 },
  maxVideos: 4,

  // Entrance: the tiles fade in one at a time, clockwise from the left (`stagger` 0 = the whole fan at once;
  // `swing` > 0 also turns each into place from further back as it comes in).
  easing: 'sine.inOut', // each tile's fade eases in and out, overlapping the next for a smooth sweep
  stagger: 32, // high = more one-at-a-time; each tile fades over enterDuration / (1 + stagger) ≈ 0.19 s
  enterDuration: 6.2,
  leaveDuration: 0.25,
  swing: 0,
  captionInset: [20, 12],
};

const RAD = Math.PI / 180;

export default class Fan extends Layout {
  static defaults = config;
  static label = 'Fan';

  constructor(engine, cfg) {
    super(engine, cfg);
    this.angle = 0; // degrees: the fan's turn from drift and swipes
    this.velocity = 0; // °/s from touch throws
    this.scrolled = new Spring(cfg.scroll.omega, { maxLead: cfg.scroll.maxLead }); // degrees from scrolling, eased
    this.spread = new Spread(cfg.spread);
  }

  resize(vp) {
    const c = this.config;
    const s = Math.min(c.maxScale, Math.max(c.minScale, vp.height / ARTBOARD.height));
    this.s = s;
    this.engine.scale = s;
    const places = Math.round(360 / c.step);
    const count = Math.max(this.items.length, places);
    if (count !== this.tiles.length) {
      this.tiles.forEach((t) => t.dispose());
      this.makeTiles(this.repeatItems(count));
    }
    const base = Math.min(c.tileWidth * s, vp.width * c.mobileMaxWidth);
    const pattern = sizePattern(this.tiles.length, c.sizes.length, c.seed);
    this.tiles.forEach((t, i) => {
      const aspect = Math.min(c.maxAspect, Math.max(c.minAspect, t.item.aspect || 1));
      t.w = base * c.sizes[pattern[i]];
      t.h = t.w / aspect;
      t.diag = Math.atan2(t.w, t.h); // radians from the tile's right edge to its centre, seen from the pivot corner
    });
    this.pivot = { x: vp.width / 2, y: vp.height + c.drop * s };
  }

  update(dt) {
    const c = this.config;
    if (!this.reduced) this.angle += c.idleSpeed * dt;
    this.angle += this.velocity * dt;
    this.velocity *= Math.pow(c.inertia, dt * 60);
    const turn = this.angle + this.scrolled.update(dt);
    const out = (c.hole + this.spread.update(turn, dt, this.reduced)) * this.s; // resting gap + speed spread

    const n = this.tiles.length;
    const period = n * c.step; // ≥ 360: with more pieces than places, some wait in the hidden half
    const lo = c.seam - 360;
    const { x: px, y: py } = this.pivot;
    const { width, height } = this.vp;
    let featured = null;
    let bestScore = 0;

    // Each tile's place on the circle this frame (or none, if it's waiting its turn).
    const placed = [];
    this.tiles.forEach((t, i) => {
      const base = turn + i * c.step;
      const a = base + Math.ceil((lo - base) / period) * period; // into [lo, lo + period)
      if (a >= c.seam) {
        t.alpha = 0;
        t.priority = 0;
        t.interactive = false;
        return;
      }
      placed.push({ t, a });
    });
    placed.sort((p, q) => p.a - q.a); // later (clockwise) on top

    placed.forEach(({ t, a }, rank) => {
      // Entrance: left to right across the visible arc (-90° … 180°), each swinging in from the one before.
      const order = Math.min(1, Math.max(0, (a + 90) / 270));
      const p = this.tileProgress(order);
      const deg = a - (1 - p) * c.swing;
      const phi = deg * RAD;
      const dir = phi - t.diag; // towards the tile's centre from the pivot
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      // Centre = pivot + the bottom-right corner→centre vector turned clockwise by phi, plus the spread.
      const lx = -t.w / 2;
      const ly = -t.h / 2;
      const bx = px + lx * cos - ly * sin; // centre with the corner on the pivot
      const by = py + lx * sin + ly * cos;
      t.restX = bx + Math.sin(dir) * out; // where it sits without the hover slide (for pick)
      t.restY = by - Math.cos(dir) * out;
      const r = out + (t.hover || 0) * c.hoverOut * this.s; // a hovered tile slides out past the others
      const cx = bx + Math.sin(dir) * r;
      const cy = by - Math.cos(dir) * r;
      t.x = cx - t.w / 2;
      t.y = cy - t.h / 2;
      t.rotation = phi;
      t.z = rank;
      t.alpha = c.swing ? Math.min(1, p * 2.5) : p;
      t.reveal = 1;
      t.pivot = this.pivot; // the title sits along the outer, most horizontal edge (see UI.updateCaption)

      // On screen if the turned tile's bounding box meets the view.
      const ex = (Math.abs(t.w * cos) + Math.abs(t.h * sin)) / 2;
      const ey = (Math.abs(t.w * sin) + Math.abs(t.h * cos)) / 2;
      const visible = cx + ex > 0 && cx - ex < width && cy - ey < height && cy + ey > 0 && t.alpha > 0;
      t.interactive = visible;
      t.priority = visible ? this.centerScore(t) : 0;
      if (t.priority > bestScore) {
        bestScore = t.priority;
        featured = t;
      }
    });

    this.featured = featured;
    if (featured) featured.priority = 2;
    // The hovered tile comes to the front of the fan (its title shows too if it has a project view).
    const hovered = this.engine.hovered;
    if (hovered && this.tiles.includes(hovered)) {
      hovered.priority = 3;
      hovered.z = placed.length;
    }
  }

  /**
   * Hover / tap target. A hovered tile slides outward, so near its inner edge it could slide out from under
   * the pointer and hand the hover to the tile behind, then slide back — a flicker. So the hovered tile keeps
   * the pointer while it's over either where the tile sits at rest or where it has slid to; otherwise the
   * top-most tile under the pointer (by resting position) wins.
   */
  pick(x, y) {
    const inside = (t, cx, cy) => {
      const dx = x - cx;
      const dy = y - cy;
      const c = Math.cos(t.rotation);
      const s = Math.sin(t.rotation);
      return Math.abs(dx * c + dy * s) <= t.w / 2 && Math.abs(-dx * s + dy * c) <= t.h / 2;
    };
    const live = (t) => t.interactive && t.alpha > 0.5 && t.restX != null;
    const h = this.engine.hovered;
    if (h && this.tiles.includes(h) && live(h) && (inside(h, h.x + h.w / 2, h.y + h.h / 2) || inside(h, h.restX, h.restY))) {
      return { tile: h };
    }
    let best = null;
    for (const t of this.tiles) {
      if (live(t) && inside(t, t.restX, t.restY) && (!best || t.z > best.z)) best = t;
    }
    return best ? { tile: best } : null;
  }

  /** Scroll down (or right) = the fan turns clockwise. */
  onWheel({ dx, dy }) {
    this.scrolled.push((dy + dx) * this.config.scroll.multiplier);
  }

  // Touch: the finger turns the fan — right or up = clockwise.
  onDrag({ dx, dy }) {
    if (!this.engine.touch) return;
    this.angle += (dx - dy) * this.config.dragMultiplier;
    this.velocity = 0;
  }

  onRelease({ vx, vy }) {
    if (!this.engine.touch) return;
    this.velocity = (vx - vy) * this.config.dragMultiplier * this.config.throw;
  }

  /** Keyboard focus: turn the fan so the item's tile stands up above the centre point. */
  focusItem(item) {
    const tile = this.tileForItem(item) ?? this.tiles.find((t) => t.item === item);
    if (!tile || tile.alpha <= 0) return;
    const current = tile.rotation / RAD;
    const upright = tile.diag / RAD; // its centre straight above the pivot
    this.scrolled.push(upright - current);
  }
}
