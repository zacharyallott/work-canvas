import gsap from 'gsap';
import { clientWork } from './about.js';

/**
 * About: hovering a client's tag shows one of their showcase pieces as a card
 * above the about copy, a little right of centre, its lower edge reaching down
 * over the headline's first line. Like a card dealt on the homepage deck, it
 * fades in turned to one of `angles` (never the same twice in a row). One card
 * at a time: the next tag's card fades in as the last one fades out. Each
 * hover of the same tag brings that client's next piece. Moving off the tags
 * fades the card out (moving straight to another tag swaps it). Clients
 * without work in the showcase show nothing.
 *
 * The card sits behind the about section in the DOM, so the headline (which
 * blends with difference) stays legible where it crosses the card.
 */
export const config = {
  angles: [0, 11.25, -11.25, 22.5, -22.5], // degrees, as the deck
  max: 1, // cards on screen at once
  dealDuration: 0.12, // s for a card to fade in (the deck's)
  clearDuration: 0.25, // s for the card to fade out after leaving the tags
  linger: 0.2, // s after leaving a tag before the card goes
  top: 44, // px kept clear for the top bar
  fill: 0.74, // card height as a fraction of the space between the top bar and the headline (leaves room for the turned corners)
  overlap: 1, // how far the card's lower edge reaches down over the headline, in its lines
  maxHeight: 380, // px
  maxWidth: 0.5, // fraction of the screen width
  x: 0.62, // card centre, as a fraction of the screen width (0.5 = centred)
  minRoom: 160, // px: with less free space than this, the card sits halfway down the screen instead
};

export class AboutPeek {
  constructor(ui, items, cfg = config) {
    this.ui = ui;
    this.config = cfg;
    this.cards = []; // { el, tween }, oldest first
    this.lastAngle = null;
    this.el = document.createElement('div');
    this.el.className = 'wc-about-peek';
    this.el.setAttribute('aria-hidden', 'true');
    ui.about.before(this.el);

    ui.about.querySelectorAll('.wc-about-clients li:not(.wc-about-label):not(.wc-about-gap)').forEach((li) => {
      const work = clientWork(li.textContent, items);
      if (!work.length) return;
      li.classList.add('has-work'); // only these react to hover
      let next = 0;
      li.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'touch') return;
        this.deal(work[next]);
        next = (next + 1) % work.length;
      });
      li.addEventListener('pointerleave', () => this.leave());
    });
  }

  /**
   * Where a card goes: `h` is the space between the top bar and the headline (the card's size follows it) and
   * `bottom` is where the card's lower edge sits, `overlap` lines down into the headline. With too little space,
   * the card sits halfway down the screen instead (`bottom` null).
   */
  area() {
    const c = this.config;
    const root = this.ui.root.getBoundingClientRect();
    const headline = this.ui.about.querySelector('.wc-about-statement');
    const top = (headline ? headline.getBoundingClientRect().top : root.bottom) - root.top;
    const x = root.width * c.x;
    if (top - c.top < c.minRoom) return { x, bottom: null, w: root.width, h: root.height - c.top * 2 };
    const line = headline ? parseFloat(getComputedStyle(headline).lineHeight) || 0 : 0;
    return { x, bottom: top + line * c.overlap, w: root.width, h: top - c.top };
  }

  /** A card's angle: one of `angles`, never the same as the card before it. */
  pickAngle() {
    const { angles } = this.config;
    let a;
    do a = angles[Math.floor(Math.random() * angles.length)];
    while (angles.length > 1 && a === this.lastAngle);
    this.lastAngle = a;
    return a;
  }

  /** Bring a piece in, once its picture has loaded. */
  deal(item) {
    const c = this.config;
    clearTimeout(this.clearTimer);
    const a = this.area();
    const aspect = item.aspect || 1.5;
    let h = Math.min(a.h * c.fill, c.maxHeight);
    let w = h * aspect;
    if (w > a.w * c.maxWidth) {
      w = a.w * c.maxWidth;
      h = w / aspect;
    }

    const el = document.createElement('div');
    el.className = 'wc-about-card';
    const y = a.bottom == null ? this.ui.root.clientHeight / 2 - h / 2 : a.bottom - h;
    Object.assign(el.style, { left: `${a.x - w / 2}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, opacity: '0' });
    gsap.set(el, { rotation: this.pickAngle() });
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = pictureFor(item, w * (window.devicePixelRatio || 1));
    el.appendChild(img);
    // Videos play in the card (muted, looping) over their poster, unless motion is reduced.
    if (item.type === 'video' && item.sources?.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const video = document.createElement('video');
      Object.assign(video, { muted: true, loop: true, playsInline: true, autoplay: true, preload: 'auto' });
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      item.sources.forEach((s) => {
        const source = document.createElement('source');
        source.src = s.src;
        if (s.type) source.type = s.type;
        video.appendChild(source);
      });
      video.addEventListener('playing', () => video.classList.add('is-playing'), { once: true });
      el.appendChild(video);
    }
    this.el.appendChild(el);

    const card = { el, tween: null };
    this.cards.push(card);
    const show = () => {
      if (!el.isConnected) return;
      card.tween = gsap.to(el, { opacity: 1, duration: c.dealDuration, ease: 'none' });
      // Past the limit, the oldest card fades out as the new one fades in.
      while (this.cards.length > c.max) this.drop(this.cards.shift(), c.dealDuration);
    };
    if (img.complete) show();
    else {
      img.addEventListener('load', show, { once: true });
      img.addEventListener('error', show, { once: true });
    }
  }

  drop(card, duration) {
    card.tween?.kill();
    gsap.to(card.el, { opacity: 0, duration, ease: 'none', onComplete: () => card.el.remove() });
  }

  /** Off a tag: clear the card unless another tag is entered first. */
  leave() {
    clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => this.clear(), this.config.linger * 1000);
  }

  clear(duration = this.config.clearDuration) {
    clearTimeout(this.clearTimer);
    this.cards.forEach((card) => this.drop(card, duration));
    this.cards = [];
  }

  destroy() {
    this.clear(0);
    this.el.remove();
  }
}

/** The smallest image level at least `px` wide (else the largest); videos use their poster. */
function pictureFor(item, px) {
  if (item.type === 'video' || !item.images?.length) return item.poster;
  const levels = item.images;
  return (levels.find((l) => l.width && l.width >= px) ?? levels[levels.length - 1]).src;
}
