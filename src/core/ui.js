import gsap from 'gsap';
import zaIcon from '../ui/za-icon.svg';
import { aboutMarkup } from './about.js';
import { EASE } from './motion.js';
import { ProjectView } from './project.js';

/**
 * DOM layer on top of the canvas: top bar (ZA icon — also the version switch — and tagline),
 * the floating caption, the about section (opened from the tagline), the
 * static fallback grid, and a visually-hidden wrapper for real links.
 * Styles are injected once and scoped to .wc-*.
 * Values from Figma: 13px inset, 16px tagline, icon enlarged from 12px to
 * 16px, 12px caption, text #F2F2F2 with mix-blend-mode: difference. The
 * tagline sits at the right edge (the version dots/lines it was centred
 * between are gone; the star switches versions now).
 */

const CSS = `
.wc-root{position:relative;overflow:hidden;background:var(--wc-bg,#f2f2f2);min-height:var(--wc-min-height,100svh);isolation:isolate;touch-action:pan-y;-webkit-user-select:none;user-select:none}
.wc-root.is-dragging{cursor:grabbing}
.wc-root.is-hovering-tile{cursor:pointer}
.wc-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .4s linear}
.wc-root.is-ready .wc-canvas{opacity:1}
.wc-root.is-about .wc-canvas,.wc-root.is-about .wc-fallback,.wc-root.is-project .wc-canvas,.wc-root.is-project .wc-fallback{opacity:0;pointer-events:none}
/* no z-index here: a stacking context would stop mix-blend-mode reaching the canvas */
.wc-ui{position:absolute;inset:0;pointer-events:none;font-family:var(--wc-font,inherit);font-weight:var(--wc-font-weight,400);color:#f2f2f2}
.wc-topbar{position:absolute;left:13px;right:13px;top:13px;display:flex;align-items:center;justify-content:space-between;mix-blend-mode:difference}
.wc-icon{display:block;width:var(--wc-icon-size,16px);height:var(--wc-icon-size,16px);padding:0;border:0;background:none;pointer-events:auto;cursor:pointer}
.wc-icon:focus-visible{outline:1px solid #f2f2f2;outline-offset:3px}
.wc-icon img{display:block;width:100%;height:100%}
.wc-tagline{display:flex;gap:8px;align-items:center;font-size:16px;font-weight:400;letter-spacing:.02em;line-height:1;color:#f2f2f2;text-decoration:none;pointer-events:auto;white-space:nowrap;cursor:pointer}
.wc-tagline:focus-visible{outline:1px solid #f2f2f2;outline-offset:4px}
/* Arrow: a 17px mask with two stacked glyphs; hover slides one out and the other in. */
.wc-arrow{position:relative;display:block;width:17px;height:17px;overflow:hidden}
.wc-arrow-track{position:absolute;left:0;top:0;width:17px;height:17px}
.wc-arrow-glyph{position:absolute;left:0;top:0;width:17px;height:17px;line-height:17px;text-align:center;transform:rotate(90deg)}
.wc-arrow-glyph.is-next{top:-17px}
.wc-tagline.is-up .wc-arrow-glyph{transform:rotate(-90deg)}
.wc-tagline.is-up .wc-arrow-glyph.is-next{top:17px}
/* About (Figma frame 49): bottom-anchored statement + client columns. */
.wc-about{position:absolute;left:0;right:0;bottom:0;padding:0 23px 18px;display:flex;flex-direction:column;gap:32px;color:#f2f2f2;mix-blend-mode:difference;opacity:0;visibility:hidden;transition:opacity .3s linear,visibility 0s linear .3s}
.wc-root.is-about .wc-about{opacity:1;visibility:visible;pointer-events:auto;-webkit-user-select:text;user-select:text;transition:opacity 0s,visibility 0s}
.wc-about .wc-w{display:inline-block;will-change:opacity}
.wc-about-statement{margin:0 0 64px;max-width:22.84em;font-size:clamp(26px,3.75vw,48px);line-height:1.25;letter-spacing:.02em;font-weight:500}
.wc-about-statement img{display:inline-block;width:.72em;height:.72em;margin-left:.3em;vertical-align:baseline} /* Cassette cap height: sits on the baseline, tops out with the capitals */
.wc-about-clients{display:flex;justify-content:space-between;gap:16px;font-family:var(--wc-font-mono,'Cassette Semi Mono',ui-monospace,monospace);font-weight:400;font-size:10px;line-height:1.25;letter-spacing:.02em;text-transform:uppercase}
.wc-about-clients ul{list-style:none;margin:0;padding:0;width:155px}
.wc-about-footer{display:flex;align-items:center;justify-content:space-between;margin-top:16px;line-height:1;font-weight:400}
.wc-about-links{display:flex;gap:16px;font-size:16px;font-weight:400;letter-spacing:.02em}
.wc-about-links a{color:inherit;text-decoration:none;white-space:nowrap}
/* Link arrow: masked like the tagline's; hover slides it out right and a new one in from the left. */
.wc-link-arrow{position:relative;display:inline-block;width:1em;height:1em;overflow:hidden;vertical-align:-.1em}
.wc-link-track{position:absolute;inset:0}
.wc-link-track>span{position:absolute;left:0;top:0;width:1em;line-height:1em;text-align:center}
.wc-link-track>span.is-next{left:-1em}
.wc-about-links a:focus-visible{outline:1px solid currentColor;outline-offset:3px}
.wc-about-copy{margin:0;font-size:16px}
.wc-caption{position:absolute;left:0;top:0;font-size:12px;font-weight:400;line-height:1.15;white-space:pre;mix-blend-mode:difference;overflow:hidden;visibility:hidden;will-change:transform}
.wc-caption-inner{display:block;transform:translateY(110%)}
.wc-hint{position:absolute;left:50%;bottom:13px;transform:translateX(-50%);font-size:11px;line-height:1;mix-blend-mode:difference;opacity:.6;white-space:nowrap}
.wc-fallback{position:absolute;inset:0;columns:160px;column-gap:12px;padding:48px 12px 12px;overflow:auto;transition:opacity .4s linear;cursor:auto}
.wc-fallback a,.wc-fallback div{display:block;break-inside:avoid;margin:0 0 12px;border-radius:4px;overflow:hidden;background:#e2e2e2}
.wc-fallback img{display:block;width:100%;height:100%;object-fit:cover}
/* Paragraphs avoid orphans and ragged endings; headings get evenly balanced lines. */
.wc-ui p{text-wrap:pretty}
.wc-ui h1,.wc-ui h2,.wc-ui h3{text-wrap:balance}
.wc-seo{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}
.wc-sr{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;display:block!important}
@media (max-width:600px){.wc-tagline{font-size:13px}.wc-about{padding:0 13px 16px;gap:28px}.wc-about-statement{margin-bottom:32px}.wc-about-clients{flex-wrap:wrap;row-gap:14px}.wc-about-clients ul{width:calc(50% - 8px)}.wc-about-footer{margin-top:4px}}
`;

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.dataset.workCanvas = '';
  style.textContent = CSS;
  document.head.appendChild(style);
}

export class UI {
  constructor(mount, { layouts, current, onAbout, onHome, tagline, hint, aboutHref = '/about' }) {
    injectStyles();
    this.mount = mount;
    this.layouts = layouts;
    const aboutId = `wc-about-${Math.random().toString(36).slice(2, 8)}`;

    this.root = document.createElement('div');
    this.root.className = 'wc-ui';
    this.root.innerHTML = `
      <div class="wc-topbar">
        <button type="button" class="wc-icon"><img src="${zaIcon}" alt="" width="16" height="16"></button>
        <a class="wc-tagline" href="${aboutHref}" aria-expanded="false" aria-controls="${aboutId}">
          <span>${tagline}</span>
          <span class="wc-arrow" aria-hidden="true"><span class="wc-arrow-track"><span class="wc-arrow-glyph">→</span><span class="wc-arrow-glyph is-next">→</span></span></span>
        </a>
      </div>
      <div class="wc-caption" aria-hidden="true"><span class="wc-caption-inner"></span></div>
      <section class="wc-about" id="${aboutId}" aria-label="About" data-wc-no-input>${aboutMarkup()}</section>
      ${hint ? `<div class="wc-hint" aria-hidden="true">${hint}</div>` : ''}
    `;
    this.caption = this.root.querySelector('.wc-caption');
    this.captionInner = this.root.querySelector('.wc-caption-inner');
    this.icon = this.root.querySelector('.wc-icon');
    this.tagline = this.root.querySelector('.wc-tagline');
    this.about = this.root.querySelector('.wc-about');
    splitWords(this.about.querySelector('.wc-about-statement'));
    this.about.querySelectorAll('.wc-about-links a').forEach((a) => {
      const track = a.querySelector('.wc-link-track');
      if (!track) return;
      let tween;
      const loop = () => {
        if (tween?.isActive() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        tween = gsap.fromTo(track, { x: 0 }, { x: () => track.offsetWidth, duration: 0.4, ease: EASE.move, onComplete: () => gsap.set(track, { x: 0 }) });
      };
      a.addEventListener('pointerenter', loop);
      a.addEventListener('focus', loop);
    });
    this.arrowTrack = this.root.querySelector('.wc-arrow-track');

    // Tagline: hover loops the arrow; click toggles the about section.
    this.tagline.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // new tab/window: follow the link
      e.preventDefault();
      onAbout?.();
    });
    this.tagline.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.icon.addEventListener('click', (e) => {
      e.preventDefault();
      onHome?.();
    });
    this.icon.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.tagline.addEventListener('pointerenter', () => this.loopArrow());
    this.tagline.addEventListener('focus', () => this.loopArrow());

    this.setActive(current);
    mount.appendChild(this.root);
    this.project = new ProjectView(this.root, {});

    this.captionState = { target: null, shown: null };
  }

  /**
   * The arrow slides out in the direction it points and an identical arrow
   * slides in behind it (from the top for ↓, from the bottom for ↑), then the
   * track resets invisibly. A running loop always finishes.
   */
  loopArrow() {
    if (this.arrowTween?.isActive() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dir = this.tagline.classList.contains('is-up') ? -1 : 1;
    this.arrowTween = gsap.fromTo(
      this.arrowTrack,
      { y: 0 },
      { y: 17 * dir, duration: 0.45, ease: EASE.move, onComplete: () => gsap.set(this.arrowTrack, { y: 0 }) },
    );
  }

  /**
   * About open: arrow turns to ↑ (Figma frame 49). As the images fade, the
   * statement dissolves in line by line, then the client list column by
   * column, then the footer — opacity only, nothing slides. Lines are whatever
   * the browser wrapped, measured when the section opens. Closing fades the
   * whole section out (CSS).
   */
  setAbout(open) {
    this.flipArrow(open);
    this.tagline.setAttribute('aria-expanded', String(open));
    this.about.setAttribute('aria-hidden', String(!open));

    const words = this.about.querySelectorAll('.wc-about-statement .wc-w');
    const columns = this.about.querySelectorAll('.wc-about-clients ul');
    const footer = this.about.querySelector('.wc-about-footer');
    this.aboutTl?.kill();
    if (!open) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    gsap.set([...words, ...columns, footer].filter(Boolean), { opacity: 0 });

    // Group words into rendered lines by their vertical centre (so the inline star
    // joins the last line even though its box is shorter than the text's).
    const lines = [];
    let lastMid = null;
    words.forEach((w) => {
      const mid = w.offsetTop + w.offsetHeight / 2;
      if (lastMid === null || Math.abs(mid - lastMid) > w.offsetHeight * 0.5) lines.push([]);
      lines[lines.length - 1].push(w);
      lastMid = mid;
    });

    this.aboutTl = gsap.timeline({ delay: 0.2, defaults: { ease: EASE.fade } }); // images are fading out meanwhile
    lines.forEach((line, i) => this.aboutTl.to(line, { opacity: 1, duration: 0.45 }, reduced ? 0 : i * 0.07));
    this.aboutTl
      .to(columns, { opacity: 1, duration: 0.3, stagger: reduced ? 0 : 0.07 }, reduced ? 0 : '-=0.2')
      .to(footer, { opacity: 1, duration: 0.3 }, reduced ? 0 : '-=0.1');
  }

  /** Swap the arrow's direction by fading it out, flipping it while hidden, and fading back in. */
  flipArrow(up) {
    if (this.tagline.classList.contains('is-up') === up) return;
    const arrow = this.tagline.querySelector('.wc-arrow');
    this.arrowFlip?.kill();
    this.arrowFlip = gsap
      .timeline()
      .to(arrow, { opacity: 0, duration: 0.1, ease: EASE.fade })
      .add(() => {
        this.arrowTween?.progress(1); // finish any hover loop so the track is reset
        this.tagline.classList.toggle('is-up', up);
      })
      .to(arrow, { opacity: 1, duration: 0.2, ease: EASE.fade });
  }

  setActive(key) {
    // The star moves on to the next version; its label says which one is showing.
    const i = this.layouts.findIndex((l) => l.key === key);
    const now = this.layouts[i];
    const next = this.layouts[(i + 1) % this.layouts.length];
    this.icon.setAttribute('aria-label', this.layouts.length > 1 ? `Showing ${now.name}. Switch to ${next.name}` : 'Back to the work');
  }

  /** Static grid, shown only when WebGL is unavailable. */
  renderFallback(items) {
    this.fallback = document.createElement('div');
    this.fallback.className = 'wc-fallback';
    this.fallback.innerHTML = items
      .map((i) => {
        const tag = i.href ? 'a' : 'div';
        return `<${tag} ${i.href ? `href="${i.href}"` : ''} style="aspect-ratio:${i.aspect.toFixed(3)}" tabindex="-1">
          <img src="${i.poster}" alt="${i.title.replace(/"/g, '&quot;')}" loading="lazy" decoding="async"></${tag}>`;
      })
      .join('');
    this.mount.insertBefore(this.fallback, this.root); // below the top bar
  }

  /**
   * Caption for the hovered tile: the project title and "  ↓". The engine only
   * passes tiles whose project has a case study (CMS switch). Bottom-left inside the tile,
   * `inset` px from its edges. It slides up into view through a mask when a
   * tile is hovered and out when the pointer leaves; the position tracks the
   * tile every frame.
   */
  updateCaption(tile, inset = [20, 12], reducedMotion = false) {
    const s = this.captionState;
    const inner = this.captionInner;

    if (tile !== s.target) {
      s.target = tile;
      this.captionTl?.kill();
      const tl = gsap.timeline();
      if (s.shown) {
        tl.to(inner, reducedMotion ? { opacity: 0, duration: 0.15 } : { yPercent: -110, duration: 0.12, ease: EASE.in });
      }
      tl.add(() => {
        s.shown = tile;
        if (tile) {
          inner.textContent = `${tile.item.title}  ↓`;
          this.captionH = this.caption.offsetHeight; // measured once per text change, not per frame
        }
      });
      if (tile) {
        tl.fromTo(
          inner,
          reducedMotion ? { yPercent: 0, opacity: 0 } : { yPercent: 110, opacity: 1 },
          { yPercent: 0, opacity: 1, duration: reducedMotion ? 0.2 : 0.3, ease: EASE.out },
        );
      }
      this.captionTl = tl;
    }

    const shown = s.shown;
    this.caption.style.visibility = shown ? 'visible' : 'hidden';
    if (shown) {
      const { x, y, h } = shown.rect;
      const cx = Math.round(x + inset[0]);
      const cy = Math.round(y + h - inset[1] - (this.captionH || 14));
      this.caption.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    }
  }

  destroy() {
    this.project?.destroy();
    this.root.remove();
    this.fallback?.remove();
  }
}

/**
 * Wraps each word of an element's text in <span class="wc-w"> (an inline
 * image, like the star, counts as a word) so they can animate one by one.
 */
function splitWords(el) {
  if (!el) return;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) frag.appendChild(document.createTextNode(part));
          else {
            const w = document.createElement('span');
            w.className = 'wc-w';
            w.textContent = part;
            frag.appendChild(w);
          }
        });
        child.replaceWith(frag);
      } else if (child.nodeName === 'IMG') {
        child.classList.add('wc-w');
      } else if (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains('wc-w')) {
        walk(child);
      }
    }
  };
  walk(el);
}

/**
 * Visually hides lists of real links without removing them from the a11y tree
 * (keyboard users can tab through them). Lists without links (the CMS
 * Projects list) should just be display:none in Webflow — that also stops the
 * hidden <img>s from downloading — so they're left alone.
 */
export function hideLinkLists(items) {
  for (const { el } of items) {
    if (!el.matches('a[href]') && !el.querySelector('a[href]')) continue;
    const list = el.closest('[data-work-list]');
    (list ?? el).classList.add('wc-sr');
  }
}
