import gsap from 'gsap';
import { Layout } from '../core/layout.js';
import { ARTBOARD } from '../core/defaults.js';
import { sizePattern, fitSize } from '../core/sizing.js';

/**
 * Version B — Stacked deck (Figma frame 48, node 1542:5581)
 *
 * Four cards in a loose pile at the centre, each offset from the others
 * (slot offsets taken from the frame). Card sizes vary: each picks a height
 * from a size scale (never the same as the card before it) and its width
 * follows the image's aspect ratio. The whole collection cycles through the
 * pile.
 *
 * Motion: the pile follows the cursor with a little lag — each of the four
 * positions lags a bit differently, so the pile trails. Cards never move
 * between positions: a new card fades in on top, in the position of the
 * oldest card, which fades out underneath it; the other cards stay exactly as
 * they are. The further the cursor is from the centre, the faster new cards
 * come in. Hovering a card pauses the stacking and brings that card to the
 * front (in place). Without a cursor (touch / pointer elsewhere) it stacks
 * slowly on its own.
 */
export const config = {
  // Size scale (design px): each card picks one of these heights; width = height × aspect.
  heights: [220, 300, 380, 460, 560],
  minWidth: 200, // narrower cards get taller instead (keeps the aspect ratio)
  maxWidth: 620, // wider cards get shorter instead
  seed: 3, // change to reshuffle which card gets which size
  // The four card positions, offset from the pile centre in design px (from Figma).
  slots: [
    { x: -110, y: 0 },
    { x: 67, y: 0 },
    { x: 155, y: -16 },
    { x: -32, y: 0 },
  ],
  minScale: 0.5,
  maxScale: 1.3,
  mobileMaxWidth: 0.72, // max fraction of mount width a card may take on narrow screens

  // Follow
  follow: 0.38, // how far the pile moves toward the cursor (fraction of the cursor's offset from centre)
  followRates: [5.5, 4, 3, 2.2], // per position (1/s; lower = more lag), so the pile trails

  // Stacking pace
  slowInterval: 2.4, // s between cards with the cursor near the centre
  fastInterval: 0.4, // s between cards with the cursor at the edge
  curve: 1.4, // >1 = pace picks up mostly toward the edges
  idleInterval: 3.2, // s between cards with no cursor over the header
  dealDuration: 0.8, // max s for a new card to fade in (shortened at fast paces)
  dealEase: 'power2.out',
  pauseOnHover: true,
  hoverToFront: true, // hovering a card brings it to the top of the pile

  hover: { zoom: 0.035, speed: 7 }, // subtle zoom inside the card, no distortion
  maxVideos: 4,

  easing: 'power4.out',
  stagger: 0.6,
  enterDuration: 1.3,
  leaveDuration: 0.7,
  captionInset: [16, 12],
};

const lerp = (a, b, t) => a + (b - a) * t;

export default class Deck extends Layout {
  static defaults = config;
  static label = 'Deck';

  constructor(engine, cfg) {
    super(engine, cfg);
    this.makeTiles(this.items);
    const n = this.tiles.length;
    this.slotCount = Math.min(cfg.slots.length, n);

    // Which tile sits in each position, and its stacking stamp (higher = nearer the top).
    // Starts like the Figma frame: position 0 on top … position 3 at the bottom.
    this.slotTile = Array.from({ length: this.slotCount }, (_, k) => k);
    this.slotStamp = Array.from({ length: this.slotCount }, (_, k) => this.slotCount - k);
    this.stamp = this.slotCount;
    this.next = this.slotCount % n; // next tile to deal
    this.fading = null; // { slot, from, fromStamp, to, p } while a new card fades in

    this.timer = 0; // 0..1 progress toward the next card
    this.anchors = cfg.slots.map(() => ({ x: 0, y: 0 })); // per-position lagged pile offset, screen px
  }

  resize(vp) {
    const c = this.config;
    const s = Math.min(c.maxScale, Math.max(c.minScale, Math.min(vp.height / ARTBOARD.height, vp.width / ARTBOARD.width) * 1.05));
    this.s = s;
    this.engine.scale = s;
    const maxW = Math.min(c.maxWidth * s, vp.width * c.mobileMaxWidth);
    const minW = Math.min(c.minWidth * s, maxW);
    this.k = maxW / c.maxWidth; // positions and card sizes shrink together on narrow screens
    const maxH = Math.max(...c.heights) * this.k;
    const pattern = sizePattern(this.tiles.length, c.heights.length, c.seed);
    this.tiles.forEach((t, i) => {
      const { w, h } = fitSize(t.item.aspect, c.heights[pattern[i]] * this.k, { minW, maxW, maxH });
      t.baseW = w;
      t.baseH = h;
    });
  }

  update(dt) {
    const c = this.config;
    const e = this.engine;
    const { width, height } = this.vp;
    const { nx, ny, inside } = e.cursor;
    const hovered = e.hovered && this.tiles.includes(e.hovered) ? e.hovered : null;

    // Pile follows the cursor; each position eases at its own rate so the pile trails.
    const tx = inside && !this.reduced ? nx * (width / 2) * c.follow : 0;
    const ty = inside && !this.reduced ? ny * (height / 2) * c.follow : 0;
    this.anchors.forEach((a, k) => {
      const r = 1 - Math.exp(-dt * c.followRates[k % c.followRates.length]);
      a.x += (tx - a.x) * r;
      a.y += (ty - a.y) * r;
    });

    // Hovering a card that isn't on top brings it to the front (it doesn't move).
    if (hovered && c.hoverToFront) {
      const k = this.slotTile.indexOf(hovered.index);
      if (k >= 0 && this.slotStamp[k] !== this.stamp) this.slotStamp[k] = ++this.stamp;
    }

    // Stacking pace: faster the further the cursor is from the centre; paused on hover.
    const dist = inside ? Math.min(1, Math.hypot(nx, ny)) : 0;
    const interval = inside ? lerp(c.slowInterval, c.fastInterval, Math.pow(dist, c.curve)) : c.idleInterval;
    const paused = (c.pauseOnHover && hovered) || this.reduced || this.progress < 1;
    if (!paused) {
      this.timer += dt / interval;
      if (this.timer >= 1) {
        this.timer = Math.min(this.timer - 1, 0.5);
        this.deal(interval);
      }
    }

    // Only the cards in the four positions (plus one fading out) are drawn.
    const cx = width / 2;
    const cy = height / 2;
    const place = (t, k) => {
      const slot = c.slots[k];
      const a = this.anchors[k];
      t.w = t.baseW;
      t.h = t.baseH;
      t.x = cx + a.x + slot.x * this.k - t.w / 2;
      t.y = cy + a.y + slot.y * this.k - t.h / 2;
    };
    for (const t of this.tiles) {
      t.alpha = 0;
      t.interactive = false;
      t.rotation = 0;
      t.reveal = 1;
      t.gray = 0;
      t.zoom = 0;
      t.priority = 0;
    }

    const order = [...this.slotStamp].sort((a, b) => b - a); // stamps, top first
    let top = null;
    this.slotTile.forEach((ti, k) => {
      const t = this.tiles[ti];
      place(t, k);
      t.z = this.slotStamp[k];
      t.alpha = this.fading?.to === ti ? this.fading.p : 1;
      t.interactive = true;
      const rank = order.indexOf(this.slotStamp[k]); // 0 = top
      t.priority = 1 - rank * 0.2;
      if (rank === 0) top = t;
      // Entering the deck (dots): cards just fade in, bottom first.
      this.applyTransition(t, Math.max(0, Math.min(1, (this.slotCount - 1 - rank) / this.slotCount)), undefined, { fade: true });
    });

    // The replaced card fades out underneath, in place.
    const f = this.fading;
    if (f && f.from !== f.to && !this.slotTile.includes(f.from)) {
      const t = this.tiles[f.from];
      place(t, f.slot);
      t.z = f.fromStamp;
      t.alpha = 1 - f.p;
    }

    this.featured = top;
    if (top) top.priority = 3;
  }

  /** Bring the next card in: it fades in on top, in place of the oldest card. */
  deal(interval = this.config.slowInterval, tileIndex = null) {
    const n = this.tiles.length;
    if (n <= this.slotCount) return;
    this.finishFade();

    let to = tileIndex ?? this.next;
    for (let guard = 0; this.slotTile.includes(to) && guard < n; guard++) to = (to + 1) % n;
    if (tileIndex == null) this.next = (to + 1) % n;

    const slot = this.slotStamp.indexOf(Math.min(...this.slotStamp)); // the oldest card's position
    const from = this.slotTile[slot];
    this.fading = { slot, from, fromStamp: this.slotStamp[slot], to, p: 0 };
    this.slotTile[slot] = to;
    this.slotStamp[slot] = ++this.stamp;

    const duration = this.reduced ? 0.2 : Math.min(this.config.dealDuration, interval * 0.9);
    this.fadeTween = gsap.to(this.fading, { p: 1, duration, ease: this.config.dealEase, onComplete: () => this.finishFade() });
  }

  finishFade() {
    this.fadeTween?.kill();
    this.fadeTween = null;
    this.fading = null;
  }

  focusItem(item) {
    const i = this.tiles.findIndex((t) => t.item === item);
    if (i < 0) return;
    const k = this.slotTile.indexOf(i);
    if (k >= 0) this.slotStamp[k] = ++this.stamp; // already in the pile: bring to front
    else this.deal(this.config.slowInterval, i);
  }

  dispose() {
    this.finishFade();
    super.dispose();
  }
}
