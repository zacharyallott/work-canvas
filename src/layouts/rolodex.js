import gsap from 'gsap';
import { Layout } from '../core/layout.js';
import { ARTBOARD } from '../core/defaults.js';
import { Spring } from '../core/spring.js';
import { Spread } from '../core/spread.js';

/**
 * Version F — Rolodex (Figma frame 1615:231)
 *
 * One column of cards down the middle of the view, like a rolodex seen from
 * the front: the card at the front is the largest, and the cards before and
 * after it sit behind, smaller the further they are from the front (depth),
 * peeking out above and below it — each one showing a band beyond the one in
 * front of it, narrower with depth, as if receding. Cards are all the same
 * width at the same depth — so the front one is always the widest — with
 * their height from the piece's real aspect ratio (very tall pieces are
 * cropped to `maxHeight`, so there's always some of the next card showing). The
 * collection loops through the column — only the pieces that open a project
 * view (`caseStudiesOnly`).
 *
 * Motion: it moves card by card and locks in. A scroll (wheel / trackpad
 * gesture, or a swipe on touch) moves it on — down the page brings the next
 * cards up to the front — easing smoothly into place, where it holds for a
 * moment. How far a scroll moves it comes from how much it scrolls: a
 * normal scroll moves one card, a long one two or three (`gesture.max`) in
 * one flowing move that eases off as each card passes the front — friction
 * at every card (`move.friction`), without coming to a dead stop — and
 * settles in and locks on the last. Scrolling while it's moving or
 * holding does nothing, so a flick's momentum doesn't carry it on; a new
 * scroll after that moves it again, and a scroll that keeps going moves on
 * again every `gesture.repeat` px. (`mode: 'smooth'` makes it roll
 * continuously instead, through a spring, settling on a whole card once the
 * scroll stops, the cards spreading apart the faster it rolls.)
 * The cursor sets a pace
 * too: nothing around the middle, then moving on faster the nearer it gets to
 * an edge — towards the bottom or right brings the next cards up, towards
 * the top or left brings the previous ones back down, by whichever edge it's
 * nearer (`cursorPace`; hovering doesn't hold it, as the column reaches the
 * top and bottom). The cards also lean a little towards the cursor, the
 * nearer ones more than those behind (`parallax`), for depth. With nothing happening it
 * flips on to the next card every `interval` s, holding while a card is
 * hovered. On load the cards fade in from the front outward. Hovering a card
 * shows its title — along its visible edge: the top for cards above the
 * front one, the bottom otherwise.
 */
export const config = {
  // Layout (design px at the 1280×794 artboard; scaled by mount height)
  tileWidth: 414, // the front card's width
  maxHeight: 440, // taller pieces are cropped to this, so the cards behind still show (every card keeps the full width)
  frontHeight: 300, // typical front card height: the cards behind are placed around it
  peek: 170, // how far the first card behind shows beyond the front one (further ones show less, with their depth)
  // How many show: landscape screens draw everything `zoom` × the design size, so the front card and two either side
  // (5 cards) all fit in the view; portrait screens (phones) — where the card width is held by the view's width —
  // space the cards further apart instead (`portraitPeek`), for the front card and three either side (7).
  zoom: 0.95,
  portraitPeek: 220,
  portraitShape: 2.16, // the portrait height ÷ width portraitPeek is set for (a 375 × 812 phone)
  // Cards shown either side of the front (landscape, portrait): any further out slide on past the edge of the view,
  // so exactly that many show and cards glide in and out of frame rather than peeking.
  showing: [2, 3],
  // How cards shrink with distance from the front: scale = floor + (1 − floor) / (1 + depth × distance²), so the
  // furthest ones never get smaller than about `floor` (1 → 0.91 → 0.72 → 0.56 at distance 0–3).
  depth: 0.12,
  depthFloor: 0.15,
  portraitDepth: 0.25, // portrait screens (phones): `depth` there (1 → 0.83 → 0.58 → 0.41), for seven cards
  centerY: 0.5, // the front card's centre, as a fraction of the view height
  slots: 6, // at least this many cards either side of the front (the loop's seam stays well off screen)
  caseStudiesOnly: true, // only pieces that open a project view (all of them if there are none)
  minAspect: 0.75, // taller than this gets cropped
  maxAspect: 1.4, // wider than this gets cropped (keeps the cards deep enough to overlap)
  minScale: 0.55,
  maxScale: 1.3, // with `zoom`, keeps the front card within a 1280 px texture on 2× screens
  mobileMaxWidth: 0.78, // the front card's width never exceeds this fraction of the view width (phones)

  // Motion (cards)
  // 'lock': card by card — each move eases along `move.ease` and locks in, holding `move.hold` s before it can move
  // again. 'smooth': a continuous roll through a spring (`scroll`), settling on a whole card.
  mode: 'lock',
  // A one-card move takes `duration` s along `ease` and then holds `hold` s. A move of more cards is one run along
  // `runEase` taking `stretch` × duration more per extra card, slowing at each card it passes — to (1 − `friction`) of
  // its pace (1 = a dead stop at each, 0 = gliding straight through) — so it has friction at every card but flows.
  move: { duration: 1.05, hold: 0.3, ease: 'power2.inOut', runEase: 'sine.inOut', stretch: 0.9, friction: 0.65 },
  // Lock: cards per scroll from how far it scrolls (px) in its first `window` s — 1 up to `from`, one more per
  // `perCard` beyond, at most `max` (the momentum after that doesn't add more). A scroll after `gap` s without wheel
  // events is a new one; one that keeps going moves on again every `repeat` px once it's locked in. Touch: a swipe
  // needs `swipe` px of travel; its length plus `swipeCarry` s of its release speed counts (`swipeFrom`, `swipePerCard`).
  gesture: { gap: 0.2, window: 0.4, repeat: 800, from: 900, perCard: 450, max: 3, swipe: 30, swipeFrom: 450, swipePerCard: 300, swipeCarry: 0.15 },
  // Lock: a longer, quicker scroll also plays its moves faster. Tempo = 1 + `amount` × (px beyond gesture.from, per
  // gesture.from) + `speed` × (peak px/s beyond `speedFrom`, per speedFrom), at most `max`; each card's move and pause
  // divide by it (the last card by its square root, so it still settles in gently). Touch uses the swipe's length
  // and release speed (`swipeSpeedFrom`).
  tempo: { amount: 0.5, speed: 0.4, speedFrom: 2000, swipeSpeedFrom: 800, max: 2.5 },
  // Smooth: cards per px scrolled; spring pace (1/s); how many cards the input can run ahead (caps a flick's speed,
  // ≈ omega × maxLead / 2 cards/s); `snapDelay` s after the scroll stops it settles on the next whole card the way it
  // was going (a nudge under `deadband` cards settles back). Touch: cards per px of swipe; s of a flick carried on.
  scroll: { multiplier: 1 / 220, omega: 5, maxLead: 1.4, snapDelay: 0.14, deadband: 0.08 },
  dragMultiplier: 1 / 260,
  throw: 0.35,
  // Cursor position → pace: cards/s rises from 0 at the dead zone (`deadZone` of the half-height around the middle
  // vertically, `deadZoneX` of the half-width sideways — about the column's edges) to `max` at the edge, along `curve`
  // (>1 = gentle near the middle, quick toward the edges), eased in and out through `response` (1/s, lower = more
  // lag). Bottom / right = on, top / left = back, by whichever edge the cursor is nearer.
  // Lock mode: the faster the pace, the quicker each card's move and hold play, so it keeps up (up to `tempo.max`).
  // Scrolling / swiping takes over from it: the cursor pace stops, and picks up again `resume` s after the last scroll.
  cursorPace: { max: 2, deadZone: 0.2, deadZoneX: 0.45, curve: 1.5, response: 3, resume: 0.8 },
  // Cursor parallax: design px the front card leans toward the cursor at the edges (x, y); cards behind lean less,
  // in step with their depth scale. Eased through `response` (1/s).
  parallax: { x: 28, y: 16, response: 3 },
  interval: 3.2, // s on each card before it flips on to the next by itself (0 = off)
  pauseOnHover: true,

  // Speed → spacing ('smooth' only): design px added to each card's `peek` per card/s above `rest`, capped at `max`.
  // The same smooth response both ways, so the column draws back together in step with the roll slowing.
  spread: { gain: 9, max: 32, rest: 0.8, omega: 5, closing: 5 },

  hover: { zoom: 0, speed: 7 },
  maxVideos: 4,

  // Entrance: from the front card outward, each dissolving in place.
  easing: 'none',
  stagger: 1.4,
  enterDuration: 1.3,
  leaveDuration: 0.25,
  captionInset: [20, 12],
};

export default class Rolodex extends Layout {
  static defaults = config;
  static label = 'Rolodex';

  constructor(engine, cfg) {
    super(engine, cfg);
    this.goal = 0; // cards: where it's headed (the front card's index, unwrapped)
    this.pos = 0; // cards: lock — the card it's locked in on; smooth — where it is
    this.shown = 0; // cards: where it's shown this frame
    this.move = null; // lock: { from, to, t, D, v0 } while a move plays
    this.hold = 0; // lock: s left holding after a move
    this.gesture = null; // lock: the scroll under way { base, dir, n, start, amount, peak }
    this.wheelLog = []; // lock: recent wheel deltas, for the scroll's speed
    this.tempo = 1; // lock: how much faster the current moves play (long, quick scrolls)
    this.moveEase = gsap.parseEase(cfg.move.ease);
    this.runEase = gsap.parseEase(cfg.move.runEase ?? cfg.move.ease);
    this.roll = new Spring(cfg.scroll.omega); // smooth: follows the goal
    this.spread = new Spread(cfg.spread);
    this.sinceInput = Infinity; // s since the last scroll / swipe
    this.dragging = false;
    this.timer = 0; // s resting on the current card
    this.settled = 0; // smooth: the whole card it last came to rest on
    this.dir = 1; // which way it last went (+1 on, -1 back)
    this.pace = 0; // cards/s from the cursor's position, eased
    this.paceCards = 0; // lock: the cursor pace's progress toward its next card
  }

  /** Only the pieces with a project view (case studies), when there are any. */
  get items() {
    const all = super.items;
    if (!this.config.caseStudiesOnly) return all;
    const linked = all.filter((item) => item.caseStudy);
    return linked.length ? linked : all;
  }

  resize(vp) {
    const c = this.config;
    const s = Math.min(c.maxScale, Math.max(c.minScale, vp.height / ARTBOARD.height));
    this.s = s;
    this.engine.scale = s;
    const count = Math.max(this.items.length, Math.ceil(c.slots * 2) + 2);
    if (count !== this.tiles.length) {
      this.tiles.forEach((t) => t.dispose());
      this.makeTiles(this.repeatItems(count));
    }
    const portrait = vp.width < vp.height;
    const base = Math.min(c.tileWidth * s * (portrait ? 1 : c.zoom), vp.width * c.mobileMaxWidth);
    this.peek = portrait ? c.portraitPeek ?? c.peek : c.peek;
    this.showing = c.showing[portrait ? 1 : 0];
    this.depth = portrait ? c.portraitDepth ?? c.depth : c.depth;
    this.unit = base / c.tileWidth; // CSS px per design px at the cards' size (below s on narrow screens)
    // Spacing follows the view height even past maxScale (big screens), so the same number of cards show; only the
    // cards' own size stops at the cap, for sharpness.
    // Portrait: in step with how tall the view is for its width (taller phones spread out, shorter ones close up).
    this.space = portrait
      ? this.unit * Math.min(1.2, Math.max(0.9, vp.height / vp.width / c.portraitShape))
      : Math.max(this.unit, Math.max(c.minScale, vp.height / ARTBOARD.height) * c.zoom);
    this.tiles.forEach((t) => {
      const aspect = Math.min(c.maxAspect, Math.max(c.minAspect, t.item.aspect || 1));
      t.baseW = base; // all the same width, so the front card is always the widest
      t.baseH = Math.min(base / aspect, c.maxHeight * this.unit);
    });
  }

  update(dt) {
    const c = this.config;
    const e = this.engine;
    const hovering = e.hovered && this.tiles.includes(e.hovered);

    this.sinceInput += dt;
    const lock = c.mode !== 'smooth';

    // Cursor pace: rolls on while the cursor is towards the top or bottom (cards/s, eased). A scroll takes over.
    const cp = c.cursorPace;
    const { nx, ny, inside } = e.cursor;
    const edge = (v, dz) => Math.max(0, (Math.abs(v) - dz) / (1 - dz)); // 0 inside the dead zone → 1 at the edge
    const my = inside ? edge(ny, cp.deadZone) : 0;
    const mx = inside ? edge(nx, cp.deadZoneX ?? cp.deadZone) : 0;
    const mag = Math.max(mx, my); // whichever edge it's nearer: bottom / right = on, top / left = back
    const way = my >= mx ? Math.sign(ny) : Math.sign(nx);
    const scrolled = performance.now() / 1000 - (this.lastWheel ?? -Infinity) < cp.resume;
    const want = this.reduced || this.progress < 1 || scrolled ? 0 : way * Math.pow(mag, cp.curve) * cp.max;

    // Cursor parallax: eased toward the cursor's offset from the middle (back to rest when it leaves).
    const pr = c.parallax;
    const ease = 1 - Math.exp(-dt * pr.response);
    const lean = this.lean ?? (this.lean = { x: 0, y: 0 });
    lean.x += ((inside && !this.reduced ? nx : 0) - lean.x) * ease;
    lean.y += ((inside && !this.reduced ? ny : 0) - lean.y) * ease;
    if (scrolled) this.pace = this.paceCards = 0;
    this.pace += (want - this.pace) * (1 - Math.exp(-dt * cp.response));
    if (Math.abs(this.pace) < 0.02 && !want) this.pace = 0;
    if (lock) {
      // Card by card: a card each time the pace has built up a whole one (and it's free to move).
      this.paceCards = Math.max(-1.2, Math.min(1.2, this.paceCards + this.pace * dt)); // no backlog while it's busy
      if (!this.pace) this.paceCards = 0;
      if (Math.abs(this.paceCards) >= 1 && !this.locked) {
        const dir = Math.sign(this.paceCards);
        this.paceCards -= dir;
        this.goal = this.pos + dir;
        // Quick enough to keep up with the pace: each move + hold takes about 1 / pace seconds.
        const m = c.move;
        this.tempo = Math.min(c.tempo.max, Math.max(1, Math.abs(this.pace) * (m.duration + m.hold)));
        this.paced = true;
        this.dir = dir;
      }
    } else if (this.pace) {
      this.input(this.pace * dt);
    }

    // Smooth: settle on a whole card once the input stops, carrying on the way it was going (a nudge settles back).
    if (!lock && !this.dragging && this.sinceInput > c.scroll.snapDelay && this.goal !== Math.round(this.goal)) {
      if (Math.abs(this.goal - this.settled) < c.scroll.deadband) this.goal = this.settled;
      else {
        // The next whole card that way — or the one before it if that's already past, so settling never runs further
        // ahead than maxLead and never turns it back.
        const far = this.dir > 0 ? Math.ceil(this.goal - 1e-6) : Math.floor(this.goal + 1e-6);
        const near = far - this.dir;
        this.goal = Math.abs(far - this.pos) > c.scroll.maxLead && (near - this.pos) * this.dir > 0 ? near : far;
      }
    }

    // With nothing happening, move on a card every `interval` s.
    const resting = lock
      ? !this.move && this.hold <= 0 && this.goal === this.pos
      : Math.abs(this.goal - this.roll.x) < 0.02 && Math.abs(this.roll.v) < 0.05;
    if (!lock && resting && Number.isInteger(this.goal)) this.settled = this.goal;
    if (c.interval && !this.reduced && resting && !(hovering && c.pauseOnHover) && this.progress >= 1) {
      this.timer += dt;
      if (this.timer >= c.interval) {
        this.timer = 0;
        this.goal += 1;
        this.tempo = 1;
        this.paced = false;
        this.dir = 1;
      }
    } else if (!resting) {
      this.timer = 0;
    }

    let roll;
    if (lock) {
      roll = this.advance(dt);
    } else {
      this.roll.target = this.goal;
      roll = this.pos = this.roll.update(dt);
    }
    this.shown = roll;
    const extra = lock ? 0 : this.spread.update(roll, dt, this.reduced) * this.unit;

    const n = this.tiles.length;
    const cx = this.vp.width / 2;
    const cy = this.vp.height * c.centerY;
    const half = (c.frontHeight / 2) * this.space;
    const peek = this.peek * this.space + extra;
    const depth = this.depth;
    const rd = Math.sqrt(depth);
    const f = c.depthFloor ?? 0;
    const H = this.vp.height;
    const scaleAt = (d) => f + (1 - f) / (1 + depth * d * d); // smaller with depth
    // The card's outer edge (top for cards above, bottom for cards below; its centre at the front) sits a band
    // further out than the one in front of it: `peek` scaled by depth all the way out, so the bands narrow as they
    // recede (the integral of the depth scale: floor × d + (1 − floor) × atan(d√depth) / √depth).
    const outAt = (d) => half * Math.min(d, 1) + peek * (f * d + ((1 - f) * Math.atan(d * rd)) / rd);
    const next = this.showing + 1; // the first place past the cards that show
    let featured = null;
    let bestD = Infinity;

    this.tiles.forEach((t, i) => {
      let u = (((i - roll) % n) + n) % n; // distance from the front: − above, + below
      if (u >= n / 2) u -= n;
      const d = Math.abs(u);
      const k = scaleAt(d);
      t.w = t.baseW * k;
      t.h = t.baseH * k;
      const frac = 0.5 + 0.5 * Math.max(-1, Math.min(1, u)); // 0 = top edge, 0.5 = centre, 1 = bottom edge
      let out = outAt(d);
      if (d > this.showing) {
        // Past the cards that show: nudged out just far enough that at the next place it's clear of the edge, so it
        // waits just off screen and comes in at the same pace as the others.
        const he = t.baseH * scaleAt(next);
        const oe = outAt(next);
        const clear = u < 0 ? cy - oe + he : H - cy - oe + he; // how far it would still overlap the view there
        out += Math.min(1, d - this.showing) * Math.max(0, clear + 12); // 12 px spare for the cursor lean
      }
      out *= Math.sign(u);
      // Parallax: nearer cards lean further toward the cursor (in step with their depth scale).
      t.x = cx - t.w / 2 + lean.x * pr.x * this.unit * k;
      t.y = cy + out - frac * t.h + lean.y * pr.y * this.unit * k;
      t.z = Math.round((n - d) * 1000) + (u * this.dir > 0 ? 1 : 0); // the front on top (level: the one coming in)
      t.rotation = 0;
      // Cards stay solid in and out of frame (no fades). The next ones either side are kept live just off screen, so
      // their images are loaded before they come in.
      const visible = t.y + t.h > 0 && t.y < H;
      t.alpha = d <= next + 0.5 ? 1 : 0;
      t.reveal = 1;
      t.captionAt = u < -0.5 ? 'top-left' : null; // the title goes on the band that shows (UI.updateCaption)
      t.interactive = visible;
      t.priority = visible ? this.centerScore(t) : 0;
      if (visible && d < bestD) {
        bestD = d;
        featured = t;
      }
      this.applyTransition(t, Math.min(1, d / 3)); // the front card first, then outward
    });

    this.featured = featured;
    if (featured) featured.priority = 2;
    if (hovering) e.hovered.priority = 3;
  }

  // ─── Lock mode ─────────────────────────────────────────────────────────────
  /** Moving or holding after a move: a scroll is spent until it's free again. */
  get locked() {
    return !!this.move || this.hold > 0 || this.goal !== this.pos;
  }

  /**
   * Plays the move toward the goal — one eased run, slowing at each card it passes — then holds. Returns the position
   * to show.
   */
  advance(dt) {
    const c = this.config.move;
    if (this.move) {
      const m = this.move;
      if (this.goal !== m.to) {
        // The scroll turned out longer: run on to the new goal from the same start, picking up at the point along
        // the new run where it is now (no jump).
        const x = this.curve(m, m.t / m.D);
        const next = { from: m.from, to: this.goal, t: 0, D: this.moveTime(Math.abs(this.goal - m.from)) };
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if ((this.curve(next, mid) - x) * Math.sign(next.to - next.from) < 0) lo = mid;
          else hi = mid;
        }
        next.t = lo * next.D;
        this.move = next;
        return this.advance(dt);
      }
      // A quicker scroll (higher tempo) hurries the move under way: same point along it, less time left.
      const want = this.moveTime(Math.abs(m.to - m.from));
      if (want < m.D) {
        m.t *= want / m.D;
        m.D = want;
      }
      m.t += dt;
      if (m.t < m.D) return this.curve(m, m.t / m.D);
      this.pos = m.to;
      this.move = null;
      this.hold = this.reduced ? 0 : c.hold / (this.paced ? this.tempo : 1);
      return this.pos;
    }
    if (this.hold > 0) {
      this.hold = Math.max(0, this.hold - dt);
    } else if (this.goal !== this.pos) {
      // Whole cards only (the cursor pace's goal can be part-way).
      const to = this.pos + Math.trunc(this.goal - this.pos);
      if (to !== this.pos) {
        this.move = { from: this.pos, to, t: 0, D: this.moveTime(Math.abs(to - this.pos)) };
        return this.advance(0);
      }
    }
    return this.pos;
  }

  /**
   * Where move `m` is at `s` (0–1): eased along `move.ease`; over several cards, along `move.runEase` with a detent
   * at each card it passes — its pace drops to (1 − friction) there and picks up again between
   * (x − friction × sin(2πx) / 2π).
   */
  curve(m, s) {
    const n = m.to - m.from;
    const a = Math.abs(n);
    const k = Math.min(1, Math.max(0, s));
    if (a <= 1) return m.from + n * this.moveEase(k);
    const x = a * this.runEase(k);
    return m.from + Math.sign(n) * (x - (this.config.move.friction * Math.sin(2 * Math.PI * x)) / (2 * Math.PI));
  }

  /** Cards a scroll (or swipe) of `amount` px moves: 1 up to `from`, one more per `perCard` beyond, at most `max`. */
  cardsFor(amount, from, perCard) {
    return Math.min(this.config.gesture.max, 1 + Math.floor(Math.max(0, amount - from) / perCard));
  }

  /** Seconds for a move of `cards`: `stretch` × duration more per extra card, quicker with the tempo (a scroll's by
   *  its square root, so the run still settles in gently; the cursor pace's at its full tempo, to keep up). */
  moveTime(cards) {
    const c = this.config.move;
    if (this.reduced) return 0.001;
    const tempo = this.paced ? this.tempo : Math.sqrt(this.tempo);
    return (c.duration * (1 + c.stretch * Math.max(0, cards - 1))) / tempo;
  }

  /** How much faster a scroll of `amount` px peaking at `peak` px/s plays its moves (1 = normal). */
  tempoFor(amount, from, peak, speedFrom) {
    const t = this.config.tempo;
    const more = t.amount * Math.max(0, amount - from) / from + t.speed * Math.max(0, peak - speedFrom) / speedFrom;
    return Math.min(t.max, 1 + more);
  }

  /** Starts a move of `n` cards on (dir +1) or back (−1) from where it's locked in (at normal tempo). */
  go(dir, n = 1) {
    this.goal = this.pos + dir * n;
    this.tempo = 1;
    this.paced = false;
    this.dir = dir;
    this.pace = this.paceCards = 0;
    this.sinceInput = 0;
  }

  // ─── Input ─────────────────────────────────────────────────────────────────
  /** Smooth: rolls it on (+) or back (−) by `cards`, noting the way it's going. Never more than maxLead ahead. */
  input(cards) {
    const lead = this.config.scroll.maxLead;
    this.goal = Math.min(this.pos + lead, Math.max(this.pos - lead, this.goal + cards));
    if (cards) this.dir = Math.sign(cards);
    this.sinceInput = 0;
  }

  /** Scroll down (or right) = the next cards come up to the front. Anywhere on the header. */
  onWheel({ dx, dy }) {
    const c = this.config;
    const g = c.gesture;
    const d = dy + dx;
    const now = performance.now() / 1000;
    const fresh = now - (this.lastWheel ?? -Infinity) > g.gap; // a new scroll, not more of the last one
    this.lastWheel = now;
    if (c.mode === 'smooth') return this.input(d * c.scroll.multiplier);
    if (!d) return;

    // The scroll's speed: px over the last 0.1 s.
    this.wheelLog = fresh ? [] : this.wheelLog.filter((w) => now - w.t < 0.1);
    this.wheelLog.push({ t: now, d: Math.abs(d) });
    const speed = this.wheelLog.reduce((a, w) => a + w.d, 0) / 0.1;

    if (fresh) {
      this.gesture = null;
      this.travel = 0;
    }
    const gs = this.gesture;
    if (gs && Math.sign(d) === gs.dir && now - gs.start < g.window) {
      // Still the start of this scroll: the further it goes, the more cards the move takes in; the further and
      // quicker, the faster they play.
      gs.amount += Math.abs(d);
      gs.peak = Math.max(gs.peak, speed);
      this.tempo = Math.max(this.tempo, this.tempoFor(gs.amount, g.from, gs.peak, c.tempo.speedFrom));
      const n = this.cardsFor(gs.amount, g.from, g.perCard);
      if (n > gs.n) {
        gs.n = n;
        this.goal = gs.base + gs.dir * n; // more cards queued on the same move
      }
      return;
    }
    if (this.locked) {
      this.travel = 0; // moving or holding: this is spent (a flick's momentum doesn't carry it on)
      return;
    }
    if (gs) {
      this.travel = (this.travel ?? 0) + d; // a scroll that keeps going moves on again every `repeat` px
      if (Math.abs(this.travel) < g.repeat) return;
    }
    this.travel = 0;
    const dir = Math.sign(d);
    const n = fresh ? this.cardsFor(Math.abs(d), g.from, g.perCard) : 1;
    this.gesture = { base: this.pos, dir, n, start: now, amount: Math.abs(d), peak: speed };
    this.go(dir, n);
  }

  // Touch: the finger rolls the column — up = on to the next card. Anywhere on the header.
  onDrag({ dy }) {
    if (!this.engine.touch) return;
    this.lastWheel = performance.now() / 1000; // like a scroll, it takes over from the cursor pace
    if (this.config.mode !== 'smooth') {
      this.swipe = (this.swipe ?? 0) + dy; // lock: the swipe moves it on release
      return;
    }
    this.dragging = true;
    this.input(-dy * this.config.dragMultiplier);
  }

  onRelease({ vy }) {
    if (!this.engine.touch) return;
    const c = this.config;
    if (c.mode !== 'smooth') {
      const travel = this.swipe ?? 0;
      this.swipe = 0;
      if (Math.abs(travel) < c.gesture.swipe || this.locked) return;
      // Lock: a longer (or quicker) swipe moves more cards, and plays them faster.
      const g = c.gesture;
      this.go(-Math.sign(travel), this.cardsFor(Math.abs(travel) + Math.abs(vy) * g.swipeCarry, g.swipeFrom, g.swipePerCard));
      this.tempo = this.tempoFor(Math.abs(travel), g.swipeFrom, Math.abs(vy), c.tempo.swipeSpeedFrom);
      return;
    }
    this.dragging = false;
    this.input(-vy * c.dragMultiplier * c.throw);
  }

  /** Keyboard focus: roll the item's card to the front. */
  focusItem(item) {
    const n = this.tiles.length;
    let best = null;
    for (let i = 0; i < n; i++) {
      if (this.tiles[i].item !== item) continue;
      let u = (((i - this.goal) % n) + n) % n;
      if (u >= n / 2) u -= n;
      if (best == null || Math.abs(u) < Math.abs(best)) best = u;
    }
    if (best != null) {
      this.goal = Math.round(this.goal + best); // may be further than maxLead
      if (best) this.dir = Math.sign(best);
    }
  }
}
