/**
 * A critically damped spring that follows a target. Scroll input moves the
 * target; the value starts from rest, speeds up and settles without
 * overshoot, so wheel steps and swipes play out with an ease in and an ease
 * out instead of jumping or stopping dead.
 *
 * `omega` sets the pace (1/s): higher = snappier. Around 4 / omega seconds
 * to settle. `maxLead` (optional) caps how far the target can run ahead of
 * the value: a big flick then moves less rather than for longer, which keeps
 * both its top speed and the time it takes to settle after the input stops
 * in check.
 */
export class Spring {
  constructor(omega = 6, { maxLead = Infinity } = {}) {
    this.omega = omega;
    this.maxLead = maxLead;
    this.x = 0; // current value
    this.v = 0; // velocity
    this.target = 0;
  }

  push(delta) {
    this.target += delta;
    if (this.target > this.x + this.maxLead) this.target = this.x + this.maxLead;
    else if (this.target < this.x - this.maxLead) this.target = this.x - this.maxLead;
  }

  update(dt) {
    const w = this.omega;
    // Semi-implicit Euler, sub-stepped so long frames stay stable.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.v += (w * w * (this.target - this.x) - 2 * w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}
