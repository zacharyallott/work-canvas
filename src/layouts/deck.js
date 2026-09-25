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
 * Motion: the pile follows the cursor with a little lag. Each of the four
 * positions follows by a different amount (parallax depth) and lags a bit
 * differently, so the pile fans out the further the cursor gets from the
 * centre and trails as it moves. Depth belongs to the position, not to the
 * stacking order, so cards still don't shift when a new one comes in. Cards never move
 * between positions. It starts with a single card; each new card fades in on
 * top in the next empty position, and once all four are filled, in the
 * position of the oldest card, which fades out underneath it. The other cards
 * stay exactly as they are. After `interval` s without a new card the next one comes in on
 * its own; moving the cursor brings in more — one per `moveStep` px of
 * travel, so faster movement stacks faster. Hovering a card pauses the
 * stacking and brings that card to the front (in place).
 */
export const config = {
  // Size scale (design px): each card picks one of these heights; width = height × aspect.
  heights: [220, 300, 380, 460, 560],
  minWidth: 200, // narrower cards get taller instead (keeps the aspect ratio)
  maxWidth: 620, // wider cards get shorter instead
  seed: 3, // change to reshuffle which card gets which size
  // The four card positions, offset from the pile centre in design px (from Figma).
  // They fill in `fillOrder` (the first card sits near the centre).
  fillOrder: [3, 1, 0, 2],
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
  followRates: [3.5, 2.6, 1.9, 1.4], // per position (1/s; lower = more lag), so the pile trails and the cursor can slip off a card
  depth: [0.9, 1.25, 0.95, 0.65], // per position: how strongly it follows the cursor (parallax; the outer positions stay moderate so the pile stays on screen)
  fan: 0.8, // how far the positions spread from the pile centre with the cursor at an edge (0.8 = offsets up to 1.8×)

  // New cards
  interval: 2, // s without a new card before the next one comes in on its own
  moveStep: 100, // CSS px of cursor travel per new card, at any screen size (lower = more cards)
  maxPerFrame: 1, // cap on cards added in a single frame during very fast moves
  dealDuration: 0.12, // s for a new card to fade in (0 = instant cut)
  dealEase: 'none',
  pauseOnHover: true,
  hoverToFront: true, // hovering a card brings it to the top of the pile

  hover: { zoom: 0, speed: 7 }, // hover only brings in the title (the image doesn't move)
  maxVideos: 4,

  easing: 'none',
  stagger: 0.45,
  enterDuration: 0.7,
  leaveDuration: 0.25,
  captionInset: [16, 12],
};


export default class Deck extends Layout {
  static defaults = config;
  static label = 'Deck';

  constructor(engine, cfg) {
    super(engine, cfg);
    this.makeTiles(this.items);
    const n = this.tiles.length;
    this.slotCount = Math.min(cfg.slots.length, n);

    // Which tile sits in each position (-1 = empty), and its stacking stamp (higher = nearer the top).
    // Starts with one card; the rest fill in as cards are dealt.
    this.fillOrder = cfg.fillOrder.filter((k) => k < this.slotCount);
    this.slotTile = Array.from({ length: this.slotCount }, () => -1);
    this.slotStamp = Array.from({ length: this.slotCount }, () => 0);
    // The first card is always one with a project view (a case study), so there's something to open.
    const first = Math.max(0, this.tiles.findIndex((t) => t.item.caseStudy));
    this.slotTile[this.fillOrder[0]] = first;
    this.slotStamp[this.fillOrder[0]] = 1;
    this.stamp = 1;
    this.next = (first + 1) % n; // next tile to deal
    this.fading = null; // { slot, from, fromStamp, to, p } while a new card fades in

    this.timer = 0; // s since the last card
    this.travel = 0; // cursor travel (px) since the last card
    this.lastPointer = null;
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
    // The positions also fan out from the pile centre the further the cursor is from the centre.
    const active = inside && !this.reduced;
    const tx = active ? nx * (width / 2) * c.follow : 0;
    const ty = active ? ny * (height / 2) * c.follow : 0;
    const fan = active ? c.fan * Math.min(1, Math.hypot(nx, ny)) : 0;
    this.anchors.forEach((a, k) => {
      const r = 1 - Math.exp(-dt * c.followRates[k % c.followRates.length]);
      const depth = c.depth[k % c.depth.length];
      const slot = c.slots[k];
      a.x += (tx * depth + slot.x * this.k * fan - a.x) * r;
      a.y += (ty * depth + slot.y * this.k * fan - a.y) * r;
    });

    // Hovering a card that isn't on top brings it to the front (it doesn't move).
    if (hovered && c.hoverToFront) {
      const k = this.slotTile.indexOf(hovered.index);
      if (k >= 0 && this.slotStamp[k] !== this.stamp) this.slotStamp[k] = ++this.stamp;
    }

    // New cards: one for every `moveStep` px the cursor travels, and one after
    // `interval` s without any. Hovering a card (or the entrance) holds both.
    const paused = (c.pauseOnHover && hovered) || this.reduced || this.progress < 1;
    const p = e.input?.pointer;
    const step = c.moveStep;
    if (inside && p) {
      if (this.lastPointer && !paused) this.travel += Math.hypot(p.x - this.lastPointer.x, p.y - this.lastPointer.y);
      this.lastPointer = { x: p.x, y: p.y };
    } else {
      this.lastPointer = null;
      this.travel = 0;
    }
    let dealt = false;
    for (let n = 0; this.travel >= step && n < c.maxPerFrame; n++) {
      this.travel -= step;
      this.deal();
      dealt = true;
    }
    this.travel = Math.min(this.travel, step * 2); // don't bank a backlog from one big swipe
    if (!paused) this.timer += dt;
    if (dealt) this.timer = 0;
    else if (this.timer >= c.interval) {
      this.timer = 0;
      this.deal();
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

    const filled = this.slotTile.filter((ti) => ti >= 0).length;
    const order = this.slotStamp.filter((_, k) => this.slotTile[k] >= 0).sort((a, b) => b - a); // stamps, top first
    let top = null;
    this.slotTile.forEach((ti, k) => {
      if (ti < 0) return; // empty position
      const t = this.tiles[ti];
      place(t, k);
      t.z = this.slotStamp[k];
      t.alpha = this.fading?.to === ti ? this.fading.p : 1;
      t.interactive = true;
      const rank = order.indexOf(this.slotStamp[k]); // 0 = top
      t.priority = 1 - rank * 0.2;
      if (rank === 0) top = t;
      // Entering the deck: cards fade in, bottom first.
      this.applyTransition(t, Math.max(0, Math.min(1, (filled - 1 - rank) / Math.max(1, filled))));
    });

    // The replaced card fades out underneath, in place.
    const f = this.fading;
    if (f && f.from >= 0 && f.from !== f.to && !this.slotTile.includes(f.from)) {
      const t = this.tiles[f.from];
      place(t, f.slot);
      t.z = f.fromStamp;
      t.alpha = 1 - f.p;
    }

    this.featured = top;
    if (top) top.priority = 3;
  }

  /** Bring the next card in: it fades in on top, in the next empty position, or else in place of the oldest card. */
  deal(tileIndex = null) {
    const n = this.tiles.length;
    const filled = this.slotTile.filter((ti) => ti >= 0).length;
    if (n <= filled) return; // every card is already showing
    this.finishFade();

    let to = tileIndex ?? this.next;
    for (let guard = 0; this.slotTile.includes(to) && guard < n; guard++) to = (to + 1) % n;
    if (tileIndex == null) this.next = (to + 1) % n;

    const empty = this.fillOrder.find((k) => this.slotTile[k] < 0);
    const oldest = this.slotStamp.indexOf(Math.min(...this.slotStamp.filter((_, k) => this.slotTile[k] >= 0)));
    const slot = empty ?? oldest;
    const from = this.slotTile[slot];
    this.fading = { slot, from, fromStamp: this.slotStamp[slot], to, p: 0 };
    this.slotTile[slot] = to;
    this.slotStamp[slot] = ++this.stamp;

    const duration = this.config.dealDuration;
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
    else this.deal(i);
  }

  dispose() {
    this.finishFade();
    super.dispose();
  }
}
