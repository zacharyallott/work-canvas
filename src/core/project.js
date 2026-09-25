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
 * The end of the page leads back to the work. The scroll simply stops on the
 * last image (a fling ends there too). Scrolling on — a fresh gesture, after a
 * short pause — pulls against resistance: the images rise a little and
 * everything fades (the info block only fades). Pull far enough and the page
 * hands back to the work; let go early and it settles back.
 *
 * The pull is driven by wheel/touch input and eased every frame rather than
 * tied to the scroll position, so it never fights the browser's own
 * (off-main-thread) scrolling — that's what made a scroll-linked version
 * jitter.
 */

export const PROJECT_CONFIG = {
  pullDistance: 0.95, // × view height of scrolling past the end to go back to the work
  gatePause: 0.25, // s without scroll input before a pull can start, so a fling stops at the end
  fadeFrom: 0.15, // pull progress where the fade starts
  lift: 72, // px the images rise over a full pull (they resist rather than follow)
  settle: 0.3, // s without input before an unfinished pull eases back
  smoothing: 10, // 1/s: how quickly what's drawn follows the input
};

const CSS = `
.wc-project{position:absolute;inset:0;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .35s linear,visibility 0s linear .35s}
.wc-root.is-project .wc-project{opacity:1;visibility:visible;pointer-events:auto;transition:opacity 0s,visibility 0s}
.wc-project-scroll{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:none;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:285px minmax(0,1fr);column-gap:53px;padding:52px 15px 12px 19px;box-sizing:border-box;-webkit-user-select:text;user-select:text;outline:none}
.wc-project-info{grid-column:1;grid-row:1;align-self:start;position:sticky;top:var(--wc-info-top,60vh);display:flex;flex-direction:column;gap:7px;color:#000}
.wc-project-title{margin:0;font-size:16px;line-height:1;font-weight:500}
.wc-project-desc{margin:0;max-width:271px;font-size:16px;line-height:1.1;font-weight:400;letter-spacing:.02em;color:#5f5f5f}
.wc-project-services{display:flex;flex-wrap:wrap;column-gap:12px;row-gap:2px;margin:0;padding:0;list-style:none;font-family:var(--wc-font-mono,'Cassette Semi Mono',ui-monospace,monospace);font-size:10px;line-height:1.25;letter-spacing:.02em;text-transform:uppercase;font-weight:500}
.wc-project-desc+.wc-project-services{margin-top:41px}
.wc-project-media{grid-column:2;grid-row:1;display:flex;flex-direction:column;align-items:flex-end;gap:12px;margin:0;padding:0;list-style:none}
.wc-project-item{position:relative;width:73.5%;border-radius:4px;overflow:hidden;background:#e2e2e2}
.wc-project-item.is-loaded{background:none} /* the placeholder grey would otherwise show as a hairline at antialiased edges */
.wc-project-item:nth-child(4n+2){width:100%}
.wc-project-item:nth-child(4n+3){width:51.8%}
.wc-project-item img{display:block;width:100%;height:auto}
.wc-project-item video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.wc-project-media{will-change:opacity,translate}
.wc-project-info{will-change:opacity}
@media (max-width:700px){
  .wc-project-scroll{grid-template-columns:minmax(0,1fr);padding:52px 12px 12px}
  .wc-project-info{position:static;grid-row:1;margin-bottom:24px}
  .wc-project-media{grid-column:1;grid-row:2}
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

/**
 * Everything that identifies a picture: its file names (minus size suffixes),
 * its Webflow asset ids — Webflow gives identical uploads one asset even under
 * different names — and a content hash where the page provides one. Two
 * entries sharing any key are the same picture.
 */
const keysOf = (it) => {
  const keys = it.hash ? [`h:${it.hash}`] : [];
  for (const url of [it.src, it.poster, it.video]) {
    if (!url) continue;
    keys.push(`n:${baseName(url)}`);
    const id = String(url).match(/\/([0-9a-f]{24})_/i);
    if (id) keys.push(`a:${id[1]}`);
  }
  return keys;
};

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
    this.onEnd = onEnd; // called when the visitor pulls past the end of the page
    this.resetPull();
    this.scroll.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
    this.scroll.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: true });
    this.scroll.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: true });
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
      items.push({ type: hero.type, src: heroSrc, srcset: hero.srcset, video: hero.sources?.at(-1)?.src, poster: hero.poster, hash: hero.hash, aspect: hero.aspect, alt: project.title, hero: true });
    }
    // No picture twice: skip gallery entries that match the hero or an earlier entry.
    const seen = new Set(items.flatMap(keysOf));
    for (const g of project.gallery ?? []) {
      const keys = keysOf(g);
      if (keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
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
      </ul>`;
    this.resetPull();
    this.scroll.scrollTop = 0;
    this.el.querySelectorAll('.wc-project-item img').forEach((img) => {
      const fit = () => {
        if (!img.naturalWidth) return;
        img.parentElement.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        img.parentElement.classList.add('is-loaded');
      };
      if (img.complete) fit();
      img.addEventListener('load', fit); // again if srcset swaps in another size
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

  // ─── Pull at the end of the page ──────────────────────────────────────────
  atEnd() {
    const s = this.scroll;
    return s.scrollTop >= s.scrollHeight - s.clientHeight - 1;
  }

  /**
   * A wheel gesture is a run of events without a `gatePause` gap (trackpad
   * momentum included). Only a gesture that starts with the page already at
   * its end pulls, so the fling that got you there just stops.
   */
  onWheel(e) {
    if (this.ended || !this.scroll.firstElementChild) return;
    const now = performance.now();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.scroll.clientHeight : 1);
    if (now - this.lastInput > PROJECT_CONFIG.gatePause * 1000) this.gestureAtEnd = this.atEnd();
    this.lastInput = now;
    if (dy < 0) this.pull = 0; // scrolling back up lets go
    else if (this.gestureAtEnd && this.atEnd()) this.addPull(dy);
    this.kick();
  }

  onTouchStart(e) {
    this.touchY = e.touches[0].clientY;
    this.gestureAtEnd = this.atEnd();
    this.lastInput = performance.now();
  }

  onTouchMove(e) {
    if (this.ended) return;
    const y = e.touches[0].clientY;
    const dy = this.touchY - y; // finger up = scrolling down
    this.touchY = y;
    this.lastInput = performance.now();
    if (dy < 0) this.pull = 0;
    else if (this.gestureAtEnd && this.atEnd()) this.addPull(dy * 1.5);
    this.kick();
  }

  addPull(dy) {
    this.pull = Math.min(1, this.pull + dy / (PROJECT_CONFIG.pullDistance * this.scroll.clientHeight));
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
    const c = PROJECT_CONFIG;
    const dt = this.lastFrame ? Math.min(0.05, (t - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = t;
    if (!this.ended && performance.now() - this.lastInput > c.settle * 1000) this.pull = 0;
    this.shown += (this.pull - this.shown) * (1 - Math.exp(-dt * c.smoothing));
    if (Math.abs(this.pull - this.shown) < 0.002) this.shown = this.pull;
    this.drawPull();
    if (this.shown !== this.pull || (this.pull > 0 && !this.ended)) this.kick();
    else this.lastFrame = 0;
  }

  drawPull() {
    const c = PROJECT_CONFIG;
    const p = this.shown;
    const media = this.scroll.querySelector('.wc-project-media');
    const info = this.scroll.querySelector('.wc-project-info');
    const fade = p > 0 ? String(1 - Math.min(1, Math.max(0, (p - c.fadeFrom) / (1 - c.fadeFrom)))) : '';
    if (media) {
      media.style.opacity = fade;
      media.style.translate = p > 0 ? `0 ${(-c.lift * (1 - (1 - p) ** 2)).toFixed(2)}px` : ''; // eases off: resistance
    }
    if (info) info.style.opacity = fade;
  }

  resetPull() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastFrame = 0;
    this.pull = 0; // input, 0..1
    this.shown = 0; // what's drawn, eased toward `pull`
    this.lastInput = 0;
    this.gestureAtEnd = false;
    this.ended = false;
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
    this.resetPull();
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
