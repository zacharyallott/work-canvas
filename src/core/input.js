/**
 * Normalised input for the header. Emits:
 *
 *   move   { x, y, inside }            pointer position in mount px
 *   down   { x, y }
 *   drag   { dx, dy, x, y }            per-event delta while pressed
 *   release{ vx, vy }                  px/s at release (for inertia)
 *   tap    { x, y, event }             press + release without travelling
 *   wheel  { dx, dy, event }           px, deltaMode-normalised
 *   scroll { dy }                      page scroll delta while the header is visible
 *
 * Vertical wheel is left to the page by default (config.wheel = 'page'); the
 * header reacts to page scroll instead. Horizontal wheel (trackpads) is always
 * consumed. With wheel = 'capture' the header takes all wheel input.
 */
export class Input {
  constructor(el, { clickSlop = 6, wheel = 'page' } = {}) {
    this.el = el;
    this.clickSlop = clickSlop;
    this.wheelMode = wheel;
    this.handlers = {};
    this.pointer = { x: 0, y: 0, inside: false };
    this.pressed = null;
    this.lastScrollY = window.scrollY;

    this.bind('pointerdown', this.onDown, el);
    this.bind('pointermove', this.onMove, window);
    this.bind('pointerup', this.onUp, window);
    this.bind('pointercancel', this.onUp, window);
    this.bind('pointerleave', this.onLeave, el);
    this.bind('wheel', this.onWheel, el, { passive: false });
    this.bind('scroll', this.onScroll, window, { passive: true });
    // Stop native image/link dragging from hijacking a drag.
    this.bind('dragstart', (e) => e.preventDefault(), el);
  }

  bind(type, fn, target, opts) {
    const bound = fn.bind(this);
    target.addEventListener(type, bound, opts);
    (this._unbind ||= []).push(() => target.removeEventListener(type, bound, opts));
  }

  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
    return this;
  }

  emit(type, payload) {
    this.handlers[type]?.forEach((fn) => fn(payload));
  }

  local(e) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom };
  }

  onDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest?.('[data-wc-no-input]')) return; // project view / about: native scroll + selection
    const p = this.local(e);
    this.pressed = { x: p.x, y: p.y, lastX: p.x, lastY: p.y, t: performance.now(), vx: 0, vy: 0, dragging: false, type: e.pointerType, id: e.pointerId };
    this.emit('down', p);
  }

  onMove(e) {
    this.lastClient = { clientX: e.clientX, clientY: e.clientY };
    const p = this.local(e);
    this.pointer = p;
    this.emit('move', p);

    const s = this.pressed;
    if (!s || e.pointerId !== s.id) return;
    const dx = p.x - s.lastX;
    const dy = p.y - s.lastY;
    if (!s.dragging && Math.hypot(p.x - s.x, p.y - s.y) > this.clickSlop) {
      // On touch, only horizontal drags belong to the header; vertical ones scroll the page.
      if (s.type === 'touch' && Math.abs(p.y - s.y) > Math.abs(p.x - s.x)) {
        this.pressed = null;
        return;
      }
      s.dragging = true;
      this.el.setPointerCapture?.(e.pointerId);
      this.el.classList.add('is-dragging');
    }
    if (s.dragging) {
      const now = performance.now();
      const dt = Math.max(1, now - s.t);
      // Exponential moving average of velocity, px/s.
      s.vx = s.vx * 0.6 + (dx / dt) * 1000 * 0.4;
      s.vy = s.vy * 0.6 + (dy / dt) * 1000 * 0.4;
      s.t = now;
      this.emit('drag', { dx, dy, x: p.x, y: p.y });
    }
    s.lastX = p.x;
    s.lastY = p.y;
  }

  onUp(e) {
    const s = this.pressed;
    if (!s || e.pointerId !== s.id) return;
    this.pressed = null;
    this.el.classList.remove('is-dragging');
    if (s.dragging) {
      // If the pointer rested before release, don't fling.
      const idle = performance.now() - s.t > 80;
      this.emit('release', { vx: idle ? 0 : s.vx, vy: idle ? 0 : s.vy });
    } else if (e.type === 'pointerup') {
      this.emit('tap', { ...this.local(e), event: e });
    }
  }

  onLeave() {
    if (this.pressed?.type === 'touch') return;
    this.pointer = { ...this.pointer, inside: false };
    this.emit('move', this.pointer);
  }

  onWheel(e) {
    if (e.target.closest?.('[data-wc-no-input]')) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.el.clientHeight : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    if (this.wheelMode === 'capture' || horizontal) {
      e.preventDefault();
      this.emit('wheel', { dx, dy, event: e });
    }
  }

  onScroll() {
    // The page moved under a still cursor: refresh `inside` without waiting for a pointermove.
    if (this.lastClient) this.pointer = this.local(this.lastClient);
    const y = window.scrollY;
    const dy = y - this.lastScrollY;
    this.lastScrollY = y;
    if (dy) this.emit('scroll', { dy });
  }

  destroy() {
    this._unbind?.forEach((fn) => fn());
    this.handlers = {};
  }
}
