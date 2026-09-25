import gsap from 'gsap';
import { Layout } from '../core/layout.js';
import { ARTBOARD } from '../core/defaults.js';

/**
 * Version B — Stacked deck (Figma frame 48, node 1542:5581)
 *
 * Four 400px cards in a loose pile at the centre, each offset from the others
 * (slot offsets taken from the frame). The whole collection cycles through
 * the pile.
 *
 * Motion: the pile follows the cursor with a little lag — each layer lags a
 * bit more than the one above it, so the stack trails. New cards land on top,
 * arriving from the cursor's side, and the bottom card fades out. The further
 * the cursor is from the centre, the faster cards stack. Hovering a card
 * pauses the stacking. Without a cursor (touch / pointer elsewhere) it stacks
 * slowly on its own.
 */
export const config = {
  tileWidth: 400,
  minHeight: 250,
  maxHeight: 516,
  // Pile slots, top → bottom, offset from the pile centre in design px (from Figma).
  slots: [
    { x: -110, y: 0 },
    { x: 67, y: 0 },
    { x: 155, y: -16 },
    { x: -32, y: 0 },
  ],
  minScale: 0.5,
  maxScale: 1.3,
  mobileTileWidth: 0.72,

  // Follow
  follow: 0.38, // how far the pile moves toward the cursor (fraction of the cursor's offset from centre)
  followRates: [5.5, 4, 3, 2.2], // per layer, top → bottom (1/s; lower = more lag)

  // Stacking pace
  slowInterval: 2.4, // s between cards with the cursor near the centre
  fastInterval: 0.4, // s between cards with the cursor at the edge
  curve: 1.4, // >1 = pace picks up mostly toward the edges
  idleInterval: 3.2, // s between cards with no cursor over the header
  dealDuration: 0.8, // max s for a card to land (shortened at fast paces)
  dealEase: 'power3.out',
  pauseOnHover: true,

  // Incoming card
  incomingDistance: 0.55, // × mount width it travels from the cursor side
  incomingRotation: 7, // deg at the start of its flight

  hover: { distortion: 0.1, zoom: 0.035, speed: 7 },
  maxVideos: 4,

  easing: 'power4.out',
  stagger: 0.6,
  enterDuration: 1.3,
  leaveDuration: 0.7,
  captionInset: [16, 12],
};

const lerp = (a, b, t) => a + (b - a) * t;
const VISIBLE = 4;

export default class Deck extends Layout {
  static defaults = config;
  static label = 'Deck';

  constructor(engine, cfg) {
    super(engine, cfg);
    this.head = 0; // float index of the top card; decreasing = a new card lands on top
    this.headTarget = 0;
    this.timer = 0; // 0..1 progress toward the next card
    this.anchors = cfg.slots.map(() => ({ x: 0, y: 0 })); // per-layer lagged pile offset, screen px
    this.dir = { x: 1, y: -0.15 }; // direction new cards arrive from (eased toward the cursor)
    this.makeTiles(this.items);
  }

  resize(vp) {
    const c = this.config;
    const s = Math.min(c.maxScale, Math.max(c.minScale, Math.min(vp.height / ARTBOARD.height, vp.width / ARTBOARD.width) * 1.05));
    this.s = s;
    this.engine.scale = s;
    this.tileW = Math.min(c.tileWidth * s, vp.width * c.mobileTileWidth);
    this.k = this.tileW / c.tileWidth; // slot offsets follow the card size
    for (const t of this.tiles) {
      t.baseH = Math.min(c.maxHeight * this.k, Math.max(c.minHeight * this.k, this.tileW / t.item.aspect));
    }
  }

  slotAt(d) {
    const slots = this.config.slots;
    const i = Math.max(0, Math.min(slots.length - 1, Math.floor(d)));
    const j = Math.min(slots.length - 1, i + 1);
    const f = Math.max(0, Math.min(1, d - i));
    return { x: lerp(slots[i].x, slots[j].x, f), y: lerp(slots[i].y, slots[j].y, f) };
  }

  anchorAt(d) {
    const i = Math.max(0, Math.min(VISIBLE - 1, Math.floor(d)));
    const j = Math.min(VISIBLE - 1, i + 1);
    const f = Math.max(0, Math.min(1, d - i));
    return { x: lerp(this.anchors[i].x, this.anchors[j].x, f), y: lerp(this.anchors[i].y, this.anchors[j].y, f) };
  }

  update(dt) {
    const c = this.config;
    const e = this.engine;
    const n = this.tiles.length;
    const { width, height } = this.vp;
    const { nx, ny, inside } = e.cursor;
    const hovering = e.hovered && this.tiles.includes(e.hovered);

    // Pile follows the cursor; each layer eases at its own rate so the stack trails.
    const tx = inside && !this.reduced ? nx * (width / 2) * c.follow : 0;
    const ty = inside && !this.reduced ? ny * (height / 2) * c.follow : 0;
    this.anchors.forEach((a, k) => {
      const r = 1 - Math.exp(-dt * c.followRates[k]);
      a.x += (tx - a.x) * r;
      a.y += (ty - a.y) * r;
    });
    if (inside && (nx || ny)) {
      const len = Math.hypot(nx, ny) || 1;
      const r = 1 - Math.exp(-dt * 4);
      this.dir.x += (nx / len - this.dir.x) * r;
      this.dir.y += (ny / len - this.dir.y) * r;
    }

    // Stacking pace: faster the further the cursor is from the centre; paused on hover.
    const dist = inside ? Math.min(1, Math.hypot(nx, ny)) : 0;
    const interval = inside ? lerp(c.slowInterval, c.fastInterval, Math.pow(dist, c.curve)) : c.idleInterval;
    const paused = (c.pauseOnHover && hovering) || this.reduced || this.progress < 1;
    if (!paused) {
      this.timer += dt / interval;
      if (this.timer >= 1) {
        this.timer = Math.min(this.timer - 1, 0.5);
        this.stack(interval);
      }
    }

    const cx = width / 2;
    const cy = height / 2;
    const dirLen = Math.hypot(this.dir.x, this.dir.y) || 1;
    const dx = this.dir.x / dirLen;
    const dy = this.dir.y / dirLen;
    let top = null;

    this.tiles.forEach((t, i) => {
      // Depth: 0 = top … 3 = bottom; (-1, 0) = landing on top; > 3 = fading out underneath.
      let d = (((i - this.head) % n) + n) % n;
      if (d > n - 1) d -= n;

      t.rotation = 0;
      t.alpha = 1;
      t.reveal = 1;
      t.gray = 0;
      t.zoom = 0;
      t.interactive = d > -0.5 && d < VISIBLE;
      t.w = this.tileW;
      t.h = t.baseH;

      let px;
      let py;
      if (d < 0) {
        // Arriving from the cursor's side, then settling onto the top slot.
        const f = -d; // 1 = far away, 0 = landed (the head tween already eases)
        const slot = this.slotAt(0);
        const a = this.anchorAt(0);
        const travel = c.incomingDistance * width;
        px = a.x + slot.x * this.k + dx * travel * f;
        py = a.y + slot.y * this.k + dy * travel * f;
        t.rotation = (Math.sign(dx || 1) * c.incomingRotation * Math.PI * f) / 180;
        t.alpha = 1 - Math.max(0, (-d - 0.6) / 0.4);
        t.z = n + 1;
      } else if (d <= VISIBLE - 1) {
        const slot = this.slotAt(d);
        const a = this.anchorAt(d);
        px = a.x + slot.x * this.k;
        py = a.y + slot.y * this.k;
        t.z = n - d;
      } else {
        // Leaving from the bottom of the pile.
        const f = Math.min(1, d - (VISIBLE - 1));
        const slot = this.slotAt(VISIBLE - 1);
        const a = this.anchorAt(VISIBLE - 1);
        px = a.x + slot.x * this.k;
        py = a.y + slot.y * this.k + 18 * this.k * f;
        t.alpha = Math.max(0, 1 - f);
        t.z = n - d;
      }

      t.x = cx + px - t.w / 2;
      t.y = cy + py - t.h / 2;

      if (Math.abs(d) < 0.5) top = t;
      t.priority = d > -0.5 && d < VISIBLE ? 1 - Math.max(0, d) * 0.2 : 0;
      this.applyTransition(t, Math.max(0, Math.min(1, (VISIBLE - 1 - d) / VISIBLE)), { y: height * 0.55 });
    });

    this.featured = top;
    if (top) top.priority = 3;
  }

  /** Land the next card on top. Rapid calls queue up smoothly (the tween retargets). */
  stack(interval = this.config.slowInterval) {
    this.headTarget = Math.round(Math.min(this.headTarget, this.head + 0.5)) - 1;
    gsap.to(this, {
      head: this.headTarget,
      duration: Math.min(this.config.dealDuration, interval * 0.9),
      ease: this.config.dealEase,
      overwrite: true,
    });
  }

  focusItem(item) {
    const i = this.tiles.findIndex((t) => t.item === item);
    if (i < 0) return;
    this.headTarget = i;
    gsap.to(this, { head: i, duration: this.config.dealDuration, ease: this.config.dealEase, overwrite: true });
  }
}
