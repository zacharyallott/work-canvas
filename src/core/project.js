import gsap from 'gsap';
import { EASE } from './motion.js';

/**
 * Project view (Figma frame 50, node 1553:6590).
 *
 * A scrolling page inside the header: the project's title, short description
 * and services pinned bottom-left, and a right-aligned column of the
 * project's images/videos (the clicked showcase piece first, then CMS
 * Image 3 onward) in a rhythm of widths.
 *
 * Plain DOM (not WebGL) so the images are real <img>/<video> elements —
 * selectable, accessible and lazy-loaded.
 *
 * Scrolling past the last image enters a runway: the images hold at the bottom
 * of the view for a moment, then drift on with friction and fade out (the info
 * block stays put and only fades); reaching the end takes you back to the work.
 * At the end of the hold the scroll stops dead — momentum from a fling can't
 * carry through — and only a fresh scroll, after a short pause, continues into
 * the fade.
 */

export const PROJECT_CONFIG = {
  runway: 2, // runway length after the last image, × view height
  hold: 0.45, // runway progress the last image stays pinned to the bottom of the view before the fade starts
  gatePause: 0.35, // s without scroll input at the end of the hold before scrolling on is allowed
  friction: 0.88, // after the hold: 0 = images keep pace with the scroll, 1 = they stay put
  closeAt: 0.98, // runway progress that returns to the work
};

const CSS = `
.wc-project{position:absolute;inset:0;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .35s linear,visibility 0s linear .35s}
.wc-root.is-project .wc-project{opacity:1;visibility:visible;pointer-events:auto;transition:opacity 0s,visibility 0s}
.wc-project-scroll{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:285px minmax(0,1fr);column-gap:53px;padding:52px 15px 12px 19px;box-sizing:border-box;-webkit-user-select:text;user-select:text}
.wc-project-info{grid-column:1;grid-row:1/3;align-self:start;position:sticky;top:var(--wc-info-top,60vh);display:flex;flex-direction:column;gap:7px;color:#000}
.wc-project-title{margin:0;font-size:16px;line-height:1;font-weight:500}
.wc-project-desc{margin:0;max-width:271px;font-size:16px;line-height:1.1;font-weight:400;color:#5f5f5f}
.wc-project-services{display:flex;flex-wrap:wrap;column-gap:12px;row-gap:2px;margin:0;padding:0;list-style:none;font-family:var(--wc-font-mono,'Cassette Semi Mono',ui-monospace,monospace);font-size:10px;line-height:1.25;letter-spacing:.02em;text-transform:uppercase;font-weight:500}
.wc-project-desc+.wc-project-services{margin-top:41px}
.wc-project-media{grid-column:2;grid-row:1;display:flex;flex-direction:column;align-items:flex-end;gap:12px;margin:0;padding:0;list-style:none}
.wc-project-item{position:relative;width:73.5%;border-radius:4px;overflow:hidden;background:#e2e2e2}
.wc-project-item:nth-child(4n+2){width:100%}
.wc-project-item:nth-child(4n+3){width:51.8%}
.wc-project-item img{display:block;width:100%;height:auto}
.wc-project-item video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.wc-project-end{grid-column:1/-1;grid-row:2;pointer-events:none}
.wc-project-media{will-change:opacity,translate}
.wc-project-info{will-change:opacity}
@media (max-width:700px){
  .wc-project-scroll{grid-template-columns:minmax(0,1fr);padding:52px 12px 12px}
  .wc-project-info{position:static;grid-row:1;margin-bottom:24px}
  .wc-project-media{grid-column:1;grid-row:2}
  .wc-project-end{grid-row:3}
  .wc-project-item,.wc-project-item:nth-child(n){width:100%}
}
`;

const INFO_BOTTOM = 12; // info block's distance from the bottom of the view, px

let injected = false;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** "…/6ab5…_boa-allott-10-lg.webp" → "boa-allott-10" (for spotting the same file twice). */
const baseName = (url) =>
  decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop() || '')
    .replace(/^[0-9a-f]{24}_/, '') // Webflow asset id prefix
    .replace(/(-p-\d+)?\.[a-z0-9]+$/i, '') // responsive variant + extension
    .replace(/-(sm|md|lg|poster)$/, '');

export class ProjectView {
  constructor(uiRoot, { onEnd } = {}) {
    if (!injected) {
      injected = true;
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.el = document.createElement('div');
    this.el.className = 'wc-project';
    this.el.dataset.wcNoInput = ''; // the canvas ignores pointer/wheel input in here
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `<div class="wc-project-scroll" tabindex="-1"></div>`;
    this.scroll = this.el.firstElementChild;
    uiRoot.prepend(this.el); // before the top bar, so the top bar draws on top
    this.onEnd = onEnd; // called when the visitor scrolls through the end runway
    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true });
    // Any scroll input (including trackpad momentum) keeps the gate at the end of the hold closed.
    this.scroll.addEventListener('wheel', () => this.gateWait(), { passive: true });
    this.scroll.addEventListener('touchend', () => this.gateWait(), { passive: true });
    this.io = new IntersectionObserver(
      (entries) => entries.forEach((e) => (e.isIntersecting ? e.target.play().catch(() => {}) : e.target.pause())),
      { root: this.scroll, threshold: 0.25 },
    );
  }

  /**
   * Builds the page for `project`. `hero` (the clicked showcase media item)
   * goes first; gallery entries that are the same file are skipped.
   */
  render(project, hero) {
    this.clear();
    const heroSrc = hero ? hero.bestSrc : '';
    const items = [];
    if (hero) {
      items.push({ type: hero.type, src: heroSrc, srcset: hero.srcset, video: hero.sources?.at(-1)?.src, aspect: hero.aspect, alt: project.title, hero: true });
    }
    const seen = new Set(items.map((i) => baseName(i.video || i.src)));
    for (const g of project.gallery ?? []) {
      const key = baseName(g.video || g.src);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(g);
    }

    const services = (project.services || '')
      .split(/\s*(?:,|→|\n)\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    this.scroll.innerHTML = `
      <div class="wc-project-info">
        <h2 class="wc-project-title">${esc(project.title)}</h2>
        ${project.description ? `<p class="wc-project-desc">${esc(project.description)}</p>` : ''}
        ${services.length ? `<ul class="wc-project-services">${services.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      </div>
      <ul class="wc-project-media" aria-label="${esc(project.title)} images">
        ${items
          .map((it) => {
            // Known ratio up front (hero); otherwise a 3:2 placeholder until the image reports its size.
            const ratio = ` style="aspect-ratio:${it.aspect ? it.aspect.toFixed(4) : '1.5'}"`;
            const img = `<img crossorigin="anonymous" src="${esc(it.src)}"${it.srcset ? ` srcset="${esc(it.srcset)}" sizes="(max-width:700px) 100vw, 70vw"` : ''} alt="${esc(it.alt)}" ${it.hero ? 'decoding="sync"' : 'loading="lazy" decoding="async"'}>`;
            const video = it.type === 'video' && it.video ? `<video src="${esc(it.video)}" crossorigin="anonymous" muted loop playsinline preload="metadata"></video>` : '';
            return `<li class="wc-project-item${it.hero ? ' is-hero' : ''}"${ratio}>${img}${video}</li>`;
          })
          .join('')}
      </ul>
      <div class="wc-project-end" aria-hidden="true" style="height:${Math.round(PROJECT_CONFIG.runway * 100)}vh"></div>`;
    this.ended = false;
    this.resetGate();
    this.scroll.scrollTop = 0;
    this.el.querySelectorAll('.wc-project-item img').forEach((img) => {
      const fit = () => img.naturalWidth && (img.parentElement.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`);
      if (img.complete) fit();
      else img.addEventListener('load', fit, { once: true });
    });
    this.el.querySelectorAll('video').forEach((v) => {
      v.muted = true;
      this.io.observe(v);
    });
    this.layoutInfo();
  }

  /** Pins the info block bottom-left of the view, level with the 12px bottom margin the images rest on. */
  layoutInfo() {
    const info = this.el.querySelector('.wc-project-info');
    if (!info) return;
    // Sticky offsets are measured inside the scroll container's padding, so remove it.
    const padTop = parseFloat(getComputedStyle(this.scroll).paddingTop) || 0;
    const top = this.el.clientHeight - INFO_BOTTOM - info.offsetHeight - padTop;
    this.el.style.setProperty('--wc-info-top', `${Math.max(0, top)}px`);
  }

  /**
   * Runway: progress p (0 → 1) through the space after the last image. The
   * images counter-move so they stay pinned at the bottom until `hold`, then
   * drift on at (1 − friction) of the scroll while everything fades; at
   * `closeAt` we hand back to the work. The info block spans the runway row,
   * so it stays pinned by `position: sticky` and only fades.
   */
  onScroll() {
    const end = this.scroll.querySelector('.wc-project-end');
    if (!end || this.ended) return;
    const runway = end.offsetHeight;
    const max = this.scroll.scrollHeight - this.scroll.clientHeight;
    const start = max - runway;
    let p = runway > 0 ? Math.min(1, Math.max(0, (this.scroll.scrollTop - start) / runway)) : 0;
    const { hold, friction, closeAt } = PROJECT_CONFIG;
    if ((this.gate === 'armed' || this.gate === 'holding') && p > hold) {
      // End of the hold: stop the scroll here (overflow:hidden also kills momentum)
      // until the current gesture is over.
      if (this.gate === 'armed') {
        this.gate = 'holding';
        this.scroll.style.overflowY = 'hidden';
        this.gateWait();
      }
      this.scroll.scrollTop = start + hold * runway;
      p = hold;
    } else if (this.gate === 'passed' && p < hold * 0.5) {
      this.gate = 'armed'; // scrolled back up: the gate applies again
    }
    const shift = (Math.min(p, hold) + Math.max(0, p - hold) * friction) * runway;
    const fade = 1 - Math.min(1, Math.max(0, (p - hold) / (closeAt - hold)));
    const media = this.scroll.querySelector('.wc-project-media');
    const info = this.scroll.querySelector('.wc-project-info');
    if (media) {
      media.style.opacity = p > 0 ? String(fade) : '';
      media.style.translate = p > 0 ? `0 ${shift}px` : '';
    }
    if (info) info.style.opacity = p > 0 ? String(fade) : '';
    if (p >= closeAt) {
      this.ended = true;
      this.onEnd?.();
    }
  }

  /** Opens the gate once there has been no scroll input for `gatePause` s. */
  gateWait() {
    if (this.gate !== 'holding') return;
    clearTimeout(this.gateTimer);
    this.gateTimer = setTimeout(() => {
      this.gate = 'passed';
      this.scroll.style.overflowY = '';
    }, PROJECT_CONFIG.gatePause * 1000);
  }

  resetGate() {
    clearTimeout(this.gateTimer);
    this.gate = 'armed';
    this.scroll.style.overflowY = '';
  }

  /** Where the hero will sit, in mount coordinates (for the tile → page morph). */
  heroRect() {
    const hero = this.el.querySelector('.wc-project-item.is-hero');
    if (!hero) return null;
    const a = hero.getBoundingClientRect();
    const b = this.el.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  }

  /** Called once the view is visible: the info and the rest of the images dissolve in around the hero. */
  reveal({ reduced = false } = {}) {
    this.el.setAttribute('aria-hidden', 'false');
    const rest = this.el.querySelectorAll('.wc-project-info, .wc-project-item:not(.is-hero)');
    gsap.fromTo(rest, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: EASE.fade, stagger: reduced ? 0 : 0.05, clearProps: 'opacity' });
    this.scroll.focus({ preventScroll: true });
  }

  hide() {
    this.el.setAttribute('aria-hidden', 'true');
    this.el.querySelectorAll('video').forEach((v) => v.pause());
    clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => this.clear(), 500); // after the fade-out
  }

  clear() {
    this.resetGate();
    this.el.querySelectorAll('video').forEach((v) => {
      this.io.unobserve(v);
      v.pause();
      v.removeAttribute('src');
      v.load();
    });
    this.scroll.innerHTML = '';
  }

  destroy() {
    this.clear();
    this.io.disconnect();
    this.el.remove();
  }
}
