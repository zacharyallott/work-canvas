/**
 * Phone tilt for the homepage on touch screens (no cursor to steer with): how far the phone is tipped from how it
 * was being held, as x (right edge down = +) and y (top edge raised = +), each -1..1, read in the screen's own
 * axes whichever way the phone is turned. Things move the way they would roll: tip right and the film strip runs
 * right; the deck and universe shift with it.
 *
 * The neutral position is where the phone was when tilt started, and it slowly follows the phone (`recenter`), so
 * holding it at a new angle (lying down, say) settles back to still.
 *
 * iOS asks the visitor first: the request has to come from a tap, so it waits for the first touch on the work
 * (`canAsk`) — the system shows its own prompt once. Elsewhere it starts straight away. Off with reduced motion.
 */
export const TILT = {
  range: 22, // degrees of tilt for the full effect
  deadZone: 0.08, // fraction of `range` around neutral that does nothing (hand tremor)
  smoothing: 8, // 1/s: how quickly the reading follows the phone (lower = steadier, laggier)
  recenter: 0.12, // 1/s: how quickly neutral follows the phone (0 = never)
};

export class Tilt {
  constructor(el, { canAsk = () => true, config = TILT } = {}) {
    this.config = config;
    this.x = 0;
    this.y = 0;
    this.active = false; // readings are coming in
    this.raw = null; // { x, y } degrees, latest reading in screen axes
    this.base = null; // neutral
    this.el = el;
    this.canAsk = canAsk;
    if (typeof window.DeviceOrientationEvent === 'undefined') return;
    // Listen straight away (readings just don't arrive until allowed), and where the browser asks, ask on the
    // first touch on the work.
    this.listen();
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      this._ask = () => {
        if (!this.canAsk()) return;
        el.removeEventListener('touchend', this._ask);
        DeviceOrientationEvent.requestPermission().catch(() => {});
      };
      el.addEventListener('touchend', this._ask, { passive: true });
    }
  }

  listen() {
    this._onOrient = (e) => {
      if (e.beta == null || e.gamma == null) return;
      const angle = screen.orientation?.angle ?? window.orientation ?? 0;
      const { beta, gamma } = e;
      // Device axes → screen axes for the way the phone is turned.
      const [x, y] = {
        0: [gamma, beta],
        90: [beta, -gamma],
        180: [-gamma, -beta],
        270: [-beta, gamma],
        '-90': [-beta, gamma],
      }[angle] ?? [gamma, beta];
      this.raw = { x, y };
    };
    window.addEventListener('deviceorientation', this._onOrient);
  }

  /** Once per frame: eases the reading and the neutral position. */
  update(dt) {
    const c = this.config;
    if (!this.raw) return;
    if (!this.base) this.base = { ...this.raw };
    const turn = (d) => ((((d + 180) % 360) + 360) % 360) - 180; // shortest way round
    const r = 1 - Math.exp(-dt * c.recenter);
    this.base.x += turn(this.raw.x - this.base.x) * r;
    this.base.y += turn(this.raw.y - this.base.y) * r;
    const norm = (d) => {
      const v = Math.max(-1, Math.min(1, turn(d) / c.range));
      const mag = Math.max(0, (Math.abs(v) - c.deadZone) / (1 - c.deadZone));
      return Math.sign(v) * mag;
    };
    const s = 1 - Math.exp(-dt * c.smoothing);
    this.x += (norm(this.raw.x - this.base.x) - this.x) * s;
    this.y += (norm(this.raw.y - this.base.y) - this.y) * s;
    this.active = true;
  }

  destroy() {
    if (this._ask) this.el.removeEventListener('touchend', this._ask);
    if (this._onOrient) window.removeEventListener('deviceorientation', this._onOrient);
  }
}
