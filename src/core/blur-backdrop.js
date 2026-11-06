import gsap from 'gsap';
import { EASE } from './motion.js';

/**
 * About: hovering a client fills the page behind the copy and the card with the card's picture, heavily blurred and
 * oversized so its edges don't show.
 */
export const BACKDROP = {
  blur: 200, // px
  scale: 1.75, // size against the screen
  fade: 0.4, // s to dissolve from one picture to the next
  settle: 0.06, // s to wait before the page changes, so running the pointer down the tags doesn't start a dissolve for each
};

export class BlurBackdrop {
  constructor(mount) {
    this.el = document.createElement('div');
    this.el.className = 'wc-backdrop';
    this.el.setAttribute('aria-hidden', 'true');
    mount.prepend(this.el);
    this.layers = []; // the picture showing (the ones fading out have left this list)
    this.shown = null;
  }

  /** Moves to this piece's picture (null: back to the plain page). */
  set(item) {
    clearTimeout(this.timer);
    if (item === this.shown) return;
    this.timer = setTimeout(() => this.apply(item), BACKDROP.settle * 1000);
  }

  apply(item) {
    const { blur, scale, fade } = BACKDROP;
    this.shown = item;
    this.layers.forEach((img) => gsap.to(img, { opacity: 0, duration: fade, ease: EASE.fade, overwrite: true, onComplete: () => img.remove() }));
    this.layers = [];
    const src = item?.poster || item?.images?.[0]?.src; // the smallest copy: the blur leaves no detail
    if (!src) return;
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.crossOrigin = 'anonymous'; // the same cache entry the textures use
    const off = `${((1 - scale) / 2) * 100}%`;
    Object.assign(img.style, { inset: off, width: `${scale * 100}%`, height: `${scale * 100}%`, filter: `blur(${blur}px)`, opacity: '0' });
    this.el.appendChild(img);
    this.layers.push(img);
    img.addEventListener('load', () => img.isConnected && gsap.to(img, { opacity: 1, duration: fade, ease: EASE.fade }), { once: true });
    img.src = src;
  }

  destroy() {
    clearTimeout(this.timer);
    gsap.killTweensOf(this.el.querySelectorAll('img'));
    this.el.remove();
  }
}
