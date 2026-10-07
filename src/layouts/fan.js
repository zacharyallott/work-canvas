import { Layout } from '../core/layout.js';
import { ARTBOARD } from '../core/defaults.js';
import { Spring } from '../core/spring.js';
import { Spread } from '../core/spread.js';
import { sizePattern } from '../core/sizing.js';

/**
 * Version D — Fan (Figma frame 54, node 1601:6774)
 *
 * The tiles fan out around one point centred just below the bottom of the view (`drop`), like
 * spokes: each tile stands on its own line out from that point, the middle of
 * its bottom edge on one of two circles around it (`rings` × `hole`: a gap in
 * the middle, the tiles alternating in and out), turned with the line —
 * so a tile pointing straight up is upright, and they lean further the further
 * round they are. Each line is 11.25° on from the one before, so 32 tiles make
 * the full circle (the lower half is below the fold). Tiles are around 400 design px wide — each picks a size
 * from a scale, never the same as its neighbour — at the piece's own aspect
 * ratio, uncropped (`shapes` can stretch them taller or wider, cropped to fit).
 * Later (more clockwise) tiles lie on top,
 * like a hand of cards.
 *
 * It's a loop: the circle has 32 places, and as the fan turns, the place
 * passing through the hidden lower half takes the next piece in the
 * collection, so a full turn brings round new work.
 *
 * Motion: on load the whole fan fades in together, unhurried.
 * Scrolling (wheel / trackpad, or a
 * swipe on touch) turns it slowly, eased through a spring; with nothing
 * happening it drifts round very slowly. The faster it turns, the further the
 * tiles move out from the centre point (see spread.js: it opens with a slight
 * lag and closes sooner than the turn slows). Hovering a tile brings it to the
 * front and slides it out past the others along its own direction, with its
 * title if it has a project view — always inside the tile's top-left corner,
 * turned with the tile.
 */
export const config = {
  // Layout (design px at the 1280×794 artboard; scaled by mount height)
  tileWidth: 400,
  // Size variety: each tile's width is tileWidth × one of these (seeded, never the same as its neighbour).
  sizes: [0.7, 0.82, 0.94, 1.06, 1.18, 1.3],
  minEdge: 160, // design px: a tile's shorter side is at least this (very wide or tall pieces grow to it)
  // Shape: each tile is the piece's own aspect ratio × one of these (seeded separately), then held within
  // min/maxAspect. [1] with no limits = every piece at its native aspect ratio, uncropped.
  shapes: [1],
  seed: 11, // change to reshuffle the sizes and shapes
  step: 11.25, // degrees between neighbouring tiles (360 / 11.25 = 32 places)
  minAspect: 0, // never taller than this (0 = no limit)
  maxAspect: Infinity, // never wider than this (Infinity = no limit)
  minScale: 0.55,
  maxScale: 1.05,
  // Sharpness: a tile never shows its image bigger than the loaded texture (maxTextureEdge, e.g. 1280 px) covers
  // on a screen this dense — big or tightly cropped tiles give way to stay crisp.
  sharpDensity: 2,
  mobileMaxWidth: 0.55, // tile width never exceeds this fraction of the view width (phones)
  seam: 180, // degrees: where places leave/join the loop — a tile pointing straight down is wholly below the fold
  hole: 640, // design px each tile sits out from the centre point at rest (a gap in the middle; the speed spread adds to it)
  // Two circles: each tile sits on one, at `hole` × one of these — never the same as its neighbour, so they
  // alternate — the inner tighter than `hole`, the outer well beyond it, so the fan is layered in and out.
  rings: [0.72, 1.32],
  drop: 360, // design px the centre point sits below the bottom edge of the view
  // Portrait screens (phones): the open centre's top edge (at rest) sits this far down the view, which sets where
  // the centre point is (lower = the arc of tiles and its centre further down).
  portraitRing: 0.72,
  portraitHole: 520, // portrait screens: `hole` there (a tighter circle suits the narrow view)
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

  // Entrance: the whole fan fades in at once, as one layer (`stagger` > 0 fades the tiles in one after another
  // instead, clockwise from the left; `swing` > 0 also turns each into place from further back as it comes in).
  easing: 'sine.inOut',
  stagger: 0,
  enterDuration: 1.2,
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
    const ringOf = sizePattern(this.tiles.length, c.rings.length, c.seed + 3);
    const shapes = sizePattern(this.tiles.length, c.shapes.length, c.seed + 7);
    const texEdge = (this.engine.options.maxTextureEdge ?? 1280) / c.sharpDensity; // CSS px the texture's longest edge covers
    this.tiles.forEach((t, i) => {
      const real = t.item.aspect || 1;
      const aspect = Math.min(c.maxAspect, Math.max(c.minAspect, real * c.shapes[shapes[i]]));
      // The part of the texture a cover crop to this shape shows (CSS px at sharpDensity) caps the width.
      const texW = real >= 1 ? texEdge : texEdge * real;
      const shown = aspect < real ? (texW / real) * aspect : texW;
      t.ring = c.rings[ringOf[i]];
      // Width from the size scale, grown if the shorter side would come out under minEdge; then the sharpness cap.
      const minW = c.minEdge * this.s * Math.max(1, aspect);
      t.w = Math.min(Math.max(base * c.sizes[pattern[i]], minW), shown);
      t.h = t.w / aspect;
    });
    const portrait = vp.width < vp.height;
    this.hole = portrait ? c.portraitHole ?? c.hole : c.hole;
    // Portrait: placed by where the open centre's top edge sits (portraitRing) rather than by `drop`.
    this.pivot = { x: vp.width / 2, y: portrait ? vp.height * c.portraitRing + this.hole * s : vp.height + c.drop * s };
  }

  update(dt) {
    const c = this.config;
    if (!this.reduced) this.angle += c.idleSpeed * dt;
    this.angle += this.velocity * dt;
    this.velocity *= Math.pow(c.inertia, dt * 60);
    const turn = this.angle + this.scrolled.update(dt);
    const spread = this.spread.update(turn, dt, this.reduced); // design px the speed adds to every ring

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
    const together = !c.stagger && !c.swing; // the whole fan fades as one layer rather than tile by tile
    this.fadeCanvas(together ? this.tileProgress(0) : 1);

    placed.forEach(({ t, a }, rank) => {
      // Entrance: left to right across the visible arc (-120° … 120°), each swinging in from the one before.
      const order = Math.min(1, Math.max(0, (a + 120) / 240));
      const p = this.tileProgress(order);
      const deg = a - (1 - p) * c.swing;
      const phi = deg * RAD;
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      // Radial: the tile stands on the line at angle phi (clockwise from straight up), the middle of its bottom
      // edge `out` px from the pivot — its own ring, plus the speed spread — so its centre is half its height further
      // along the same line.
      const out = (this.hole * (t.ring ?? 1) + spread) * this.s;
      const [ux, uy] = [sin, -cos]; // unit vector along the line, outward
      t.restX = px + ux * (out + t.h / 2); // where it sits without the hover slide (for pick)
      t.restY = py + uy * (out + t.h / 2);
      const r = out + (t.hover || 0) * c.hoverOut * this.s + t.h / 2; // a hovered tile slides out past the others
      const cx = px + ux * r;
      const cy = py + uy * r;
      t.x = cx - t.w / 2;
      t.y = cy - t.h / 2;
      t.rotation = phi;
      t.z = rank;
      t.alpha = together ? 1 : c.swing ? Math.min(1, p * 2.5) : p;
      t.reveal = 1;
      t.captionAt = 'top-left'; // the title sits inside the tile's top-left corner, turned with it (UI.updateCaption)

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
    this.scrolled.push(-tile.rotation / RAD); // turn it back to 0°: standing straight up above the pivot
  }
}
