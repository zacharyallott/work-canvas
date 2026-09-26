/**
 * Pull past the end, shared by the project view and the about section. Once
 * the panel is scrolled to its end (or doesn't scroll at all), scrolling on
 * pulls against resistance: what's drawn rises a little and fades. A full pull
 * hands back to the work; let go early and it settles back.
 *
 * A wheel gesture is a run of events without a `gatePause` gap (trackpad
 * momentum included). A gesture that starts with the panel already at its end
 * pulls straight away; one that arrives there (the scroll that got you to the
 * end) holds for `holdAtEnd` s first, then carries on into the pull, so a
 * fling still stops at the end.
 *
 * The pull is driven by wheel/touch input and eased every frame rather than
 * tied to the scroll position, so it never fights the browser's own
 * (off-main-thread) scrolling — that's what made a scroll-linked version
 * jitter.
 */
export const PULL_CONFIG = {
  pullDistance: 0.45, // × view height of scrolling past the end to go back to the work
  gatePause: 0.15, // s without scroll input that makes the next scroll a new gesture (which can pull straight away)
  holdAtEnd: 0.3, // s a continuing gesture holds at the end before it starts pulling, so a fling still stops there
  fadeFrom: 0.15, // pull progress where the fade starts
  lift: 72, // px what's drawn rises over a full pull (it resists rather than follows)
  settle: 0.7, // s without input before an unfinished pull eases back
  smoothing: 10, // 1/s: how quickly what's drawn follows the input
};

export class Pull {
  /**
   * input: element whose wheel/touch events drive the pull (its height sets the pull distance)
   * scroller: the element whose scroll position decides "at the end" (default: input)
   * draw({ p, opacity, lift }): paints the eased progress; opacity is null and lift 0 at rest
   * onEnd(): a full pull
   * enabled(): whether input should pull right now
   */
  constructor({ input, scroller = input, draw, onEnd, enabled = () => true, config = PULL_CONFIG }) {
    Object.assign(this, { input, scroller, draw, onEnd, enabled, config });
    this.reset();
    input.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
    input.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: true });
    input.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: true });
  }

  atEnd() {
    const s = this.scroller;
    return s.scrollTop >= s.scrollHeight - s.clientHeight - 1;
  }

  onWheel(e) {
    if (this.ended || !this.enabled()) return;
    const c = this.config;
    const now = performance.now();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.input.clientHeight : 1);
    const atEnd = this.atEnd();
    if (now - this.lastInput > c.gatePause * 1000) this.gestureAtEnd = atEnd;
    this.endSince = atEnd ? this.endSince || now : 0;
    this.lastInput = now;
    const held = now - this.endSince >= c.holdAtEnd * 1000;
    if (dy < 0) this.pull = 0; // scrolling back up lets go
    else if (atEnd && (this.gestureAtEnd || held)) this.addPull(dy);
    this.kick();
  }

  onTouchStart(e) {
    if (!this.enabled()) return;
    this.touchY = e.touches[0].clientY;
    this.gestureAtEnd = this.atEnd();
    this.lastInput = performance.now();
  }

  onTouchMove(e) {
    if (this.ended || !this.enabled() || this.touchY == null) return;
    const y = e.touches[0].clientY;
    const dy = this.touchY - y; // finger up = scrolling down
    this.touchY = y;
    this.lastInput = performance.now();
    if (dy < 0) this.pull = 0;
    else if (this.gestureAtEnd && this.atEnd()) this.addPull(dy * 1.5);
    this.kick();
  }

  addPull(dy) {
    this.pull = Math.min(1, this.pull + dy / (this.config.pullDistance * this.input.clientHeight));
    if (this.pull >= 1 && !this.ended) {
      this.ended = true;
      this.onEnd?.();
    }
  }

  kick() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Eases what's drawn toward the pull; lets an unfinished pull settle back once input stops. */
  frame(t) {
    this.raf = 0;
    const c = this.config;
    const dt = this.lastFrame ? Math.min(0.05, (t - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = t;
    if (!this.ended && performance.now() - this.lastInput > c.settle * 1000) this.pull = 0;
    this.shown += (this.pull - this.shown) * (1 - Math.exp(-dt * c.smoothing));
    if (Math.abs(this.pull - this.shown) < 0.002) this.shown = this.pull;
    this.paint();
    if (this.shown !== this.pull || (this.pull > 0 && !this.ended)) this.kick();
    else this.lastFrame = 0;
  }

  paint() {
    const c = this.config;
    const p = this.shown;
    this.draw?.({
      p,
      opacity: p > 0 ? 1 - Math.min(1, Math.max(0, (p - c.fadeFrom) / (1 - c.fadeFrom))) : null,
      lift: p > 0 ? -c.lift * (1 - (1 - p) ** 2) : 0, // eases off: resistance
    });
  }

  reset() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastFrame = 0;
    this.pull = 0; // input, 0..1
    this.shown = 0; // what's drawn, eased toward `pull`
    this.lastInput = 0;
    this.gestureAtEnd = false;
    this.endSince = 0; // when the current gesture reached the end
    this.touchY = null;
    this.ended = false;
    this.paint();
  }
}
