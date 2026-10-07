import gsap from 'gsap';
import zaIcon from '../ui/za-icon.svg';
import { aboutMarkup } from './about.js';
import { EASE } from './motion.js';
import { ProjectView } from './project.js';
import { Pull } from './pull.js';

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
/* Full visible screen: svh leaves out the mobile browser toolbars (100vh would slide under them). */
.wc-root{position:relative;overflow:hidden;background:var(--wc-bg,#f2f2f2);height:100vh;isolation:isolate;touch-action:pan-y;-webkit-user-select:none;user-select:none}
.wc-root.is-dragging{cursor:grabbing}
.wc-root.is-hovering-tile{cursor:pointer}
.wc-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .4s linear;touch-action:none} /* swipes in any direction drive the layouts */
.wc-root.is-ready .wc-canvas{opacity:1}
/* Leaving the about section: the work only starts to fade back once the about copy has gone (no cross-fade). */
.wc-root.is-leaving-about .wc-canvas{transition:opacity .45s linear .45s}
.wc-root.is-about .wc-canvas,.wc-root.is-about .wc-fallback,.wc-root.is-project .wc-canvas,.wc-root.is-project .wc-fallback{opacity:0;pointer-events:none}
/* no z-index here: a stacking context would stop mix-blend-mode reaching the canvas */
.wc-ui{position:absolute;inset:0;pointer-events:none;font-family:var(--wc-font,inherit);font-weight:var(--wc-font-weight,400);color:#f2f2f2}
/* Above everything else (about, project view, caption) so it always blends with what's behind it and stays
   tappable when project images scroll under it; its own layer keeps Safari blending it against the page. */
.wc-topbar{position:absolute;left:13px;right:13px;top:13px;z-index:2;display:flex;align-items:center;justify-content:space-between;mix-blend-mode:difference;will-change:transform}
.wc-icon{display:block;width:var(--wc-icon-size,16px);height:var(--wc-icon-size,16px);padding:0;border:0;background:none;pointer-events:auto;cursor:pointer}
.wc-icon:focus-visible{outline:1px solid #f2f2f2;outline-offset:3px}
.wc-icon img{display:block;width:100%;height:100%;pointer-events:none}
.wc-tagline{display:flex;gap:8px;align-items:center;font-size:16px;font-weight:500;letter-spacing:.02em;line-height:1;color:#f2f2f2;text-decoration:none;pointer-events:auto;white-space:nowrap;cursor:pointer}
.wc-tagline:focus-visible{outline:1px solid #f2f2f2;outline-offset:4px}
/* Arrow: a 17px mask with two stacked glyphs; hover slides one out and the other in. */
.wc-arrow{position:relative;display:block;width:17px;height:17px;overflow:hidden}
.wc-arrow-track{position:absolute;left:0;top:0;width:17px;height:17px}
.wc-arrow-glyph{position:absolute;left:0;top:0;width:17px;height:17px;line-height:17px;text-align:center;transform:rotate(90deg)}
.wc-arrow-glyph.is-next{top:-17px}
.wc-tagline.is-up .wc-arrow-glyph{transform:rotate(-90deg)}
.wc-tagline.is-up .wc-arrow-glyph.is-next{top:17px}
/* About (Figma frame 49, 1542:5601): bottom-anchored headline, then the intro + client columns, then the footer. The
   section blends with difference (like the top bar), so colours are written inverted against the #f2f2f2 page:
   #939393 → #5f5f5f grey text; tags #101010 on #e2e2e2 text → #e2e2e2 tags with near-black text. */
.wc-about{position:absolute;left:0;right:0;bottom:0;translate:0 var(--wc-pull-lift,0px);box-sizing:border-box;max-height:calc(100% - 44px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;padding:0 23px 24px;display:flex;flex-direction:column;gap:48px;color:#f2f2f2;mix-blend-mode:difference;opacity:0;visibility:hidden;transition:opacity .3s linear,visibility 0s linear .3s}
.wc-root.is-about .wc-about{opacity:var(--wc-pull-fade,1);visibility:visible;pointer-events:auto;-webkit-user-select:text;user-select:text;transition:opacity 0s,visibility 0s}
.wc-about .wc-w{display:inline-block}
.wc-about-statement{margin:0 0 48px;max-width:24.6em;font-size:clamp(22px,min(3.75vw,6.2vh),48px);line-height:1.25;letter-spacing:.02em;font-weight:500} /* 96px to the row (the section's 48 + 48) */
.wc-about-statement img{display:inline-block;width:.72em;height:.72em;margin-left:.3em;vertical-align:baseline} /* Cassette cap height: sits on the baseline, tops out with the capitals */
.wc-about-row{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.wc-about-intro{margin:0;flex:0 1 263px;min-width:0;font-size:16px;line-height:1.25;font-weight:400;color:#939393}
.wc-about-clients{display:contents} /* its columns share the row's even spacing with the intro */
.wc-about-clients ul{list-style:none;margin:0;padding:0;flex:0 1 165px;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:4px;font-family:var(--wc-font-mono,'Cassette Semi Mono',ui-monospace,monospace);font-weight:400;font-size:10px;line-height:1;letter-spacing:.02em;text-transform:uppercase} /* type matches the project service tags */
.wc-about-clients li{padding:3px 6px;border-radius:3px;background:#101010;color:#e2e2e2;white-space:nowrap} /* a tag, like the project services */
.wc-about-clients li.wc-about-label{background:none;color:inherit}
.wc-about-clients li.wc-about-gap{background:none;height:10px}
.wc-about-footer{display:flex;align-items:center;justify-content:space-between;line-height:1;font-weight:500}
.wc-about-links{display:flex;gap:16px;font-size:12px;font-weight:500;letter-spacing:.02em}
.wc-about-links a{color:inherit;text-decoration:none;white-space:nowrap}
/* Link arrow: masked like the tagline's; hover slides it out right and a new one in from the left. */
.wc-link-arrow{position:relative;display:inline-block;width:1em;height:1em;overflow:hidden;vertical-align:-.1em}
.wc-link-track{position:absolute;inset:0}
.wc-link-track>span{position:absolute;left:0;top:0;width:1em;line-height:1em;text-align:center}
.wc-link-track>span.is-next{left:-1em}
.wc-about-links a:focus-visible{outline:1px solid currentColor;outline-offset:3px}
.wc-about-copy{margin:0;font-size:16px}
.wc-caption{position:absolute;left:0;top:0;transform-origin:0 0;font-size:12px;font-weight:400;line-height:1.15;white-space:pre;mix-blend-mode:difference;overflow:hidden;visibility:hidden;will-change:transform}
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
@supports (height:100svh){.wc-root{height:100svh}}
.wc-about::-webkit-scrollbar{display:none}
@media (max-width:600px){.wc-tagline{font-size:13px}.wc-about{padding:0 13px 16px;gap:28px}.wc-about-statement{margin-bottom:16px}.wc-about-row{flex-wrap:wrap;justify-content:flex-start;row-gap:16px}.wc-about-intro{flex:0 0 100%}.wc-about-clients ul{flex:0 0 calc(50% - 8px)}}
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
    // Scrolling on at the bottom of the about section pulls back to the work, like the end of a project page.
    this.aboutOpen = false;
    this.aboutPull = new Pull({
      input: mount,
      scroller: this.about,
      enabled: () => this.aboutOpen,
      draw: ({ opacity, lift }) => {
        this.about.style.setProperty('--wc-pull-fade', opacity == null ? '' : String(opacity));
        this.about.style.setProperty('--wc-pull-lift', lift ? `${lift.toFixed(2)}px` : '');
      },
      onEnd: () => this.onAboutEnd?.(),
    });
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
    // Star: each hover turns it another 45°, easing in and out.
    this.starAngle = 0;
    const turnStar = () => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      this.starAngle += 45;
      gsap.to(this.icon.querySelector('img'), { rotation: this.starAngle, duration: 0.6, ease: EASE.move, overwrite: true });
    };
    this.icon.addEventListener('pointerenter', turnStar);
    this.icon.addEventListener('focus', turnStar);
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
    this.aboutOpen = open;
    this.aboutPull.reset();
    this.flipArrow(open);
    this.tagline.setAttribute('aria-expanded', String(open));
    this.about.setAttribute('aria-hidden', String(!open));

    const words = this.about.querySelectorAll('.wc-about-statement .wc-w');
    const columns = this.about.querySelectorAll('.wc-about-intro, .wc-about-clients ul');
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
          this.captionW = this.caption.offsetWidth;
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
      const { x, y, w, h } = shown.rect;
      const rot = shown.rect.rotation || 0;
      const capH = this.captionH || 14;
      if (shown.captionAt === 'top-left') {
        // Fixed in the tile's own frame (fan): inside its top-left corner, turned with the tile — or its bottom-left
        // corner when the top of the tile runs off the top of the view (or under the top bar), so it stays readable.
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const lx = -w / 2 + inset[0];
        const capW = this.captionW || 0;
        const at = (ly) => [x + w / 2 + lx * cos - ly * sin, y + h / 2 + lx * sin + ly * cos];
        // Highest point of the caption box (its four corners) when its top-left sits at (lx, ly) in the tile.
        const top = (ly) => Math.min(...[[0, 0], [capW, 0], [0, capH], [capW, capH]].map(([dx, dy]) => y + h / 2 + (lx + dx) * sin + (ly + dy) * cos));
        const clear = 36; // below the top bar
        const lyTop = -h / 2 + inset[1];
        const ly = top(lyTop) < clear ? h / 2 - inset[1] - capH : lyTop;
        const [cx, cy] = at(ly);
        this.caption.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) rotate(${rot.toFixed(4)}rad)`;
      } else if (!rot) {
        const cx = Math.round(x + inset[0]);
        const cy = Math.round(y + h - inset[1] - capH);
        this.caption.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      } else {
        // A turned tile (fan): the title lies along one of the tile's edges, just inside it, reading left to
        // right. First choice: the two edges nearest horizontal, the outer one (further from the fan's centre)
        // first; if neither keeps the whole title on screen, the other two. Along the edge it starts `inset`
        // in from the left end, sliding along if that would run off either side of the view.
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const ox = x + w / 2;
        const oy = y + h / 2;
        const at = ([lx, ly]) => [ox + lx * cos - ly * sin, oy + lx * sin + ly * cos];
        const [hw, hh] = [w / 2, h / 2];
        const topBottom = [[[-hw, -hh], [hw, -hh]], [[-hw, hh], [hw, hh]]];
        const leftRight = [[[-hw, -hh], [-hw, hh]], [[hw, -hh], [hw, hh]]];
        // The tile's own x axis runs at `rot` on screen, its y axis at rot + 90°.
        const flatFirst = Math.abs(cos) >= Math.abs(sin) ? [topBottom, leftRight] : [leftRight, topBottom];
        const pivot = shown.pivot ?? { x: ox, y: oy + h };
        const reach = (edge) => {
          const [a, b] = edge.map(at);
          return Math.hypot((a[0] + b[0]) / 2 - pivot.x, (a[1] + b[1]) / 2 - pivot.y);
        };
        const outerFirst = (pair) => (reach(pair[0]) >= reach(pair[1]) ? pair : [pair[1], pair[0]]);
        const vw = this.root.clientWidth;
        const vh = this.root.clientHeight;
        const cw = this.captionW || 0;
        const place = (edge) => {
          let [p, q] = edge.map(at);
          if (q[0] < p[0]) [p, q] = [q, p]; // run from the left end, so the text reads left to right
          const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
          const [ux, uy] = [Math.cos(ang), Math.sin(ang)]; // along the text
          const [dx, dy] = [-uy, ux]; // "down" in the text's frame
          const below = (ox - (p[0] + q[0]) / 2) * dx + (oy - (p[1] + q[1]) / 2) * dy > 0; // tile is under the line
          const off = below ? inset[1] : -(inset[1] + capH); // keep the text inside the tile
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          let s = inset[0];
          if (ux > 0.05) {
            const lo = Math.min(dx * off, dx * (off + capH)); // x of the box's left corners, relative
            const hi = Math.max(dx * off, dx * (off + capH));
            const fromLeft = (16 - p[0] - lo) / ux; // leftmost corner on screen
            const toRight = (vw - 16 - p[0] - hi) / ux - cw; // rightmost corner on screen
            s = Math.max(0, Math.min(Math.max(inset[0], fromLeft), toRight, len - inset[0] - cw));
          }
          const cx = p[0] + ux * s + dx * off;
          const cy = p[1] + uy * s + dy * off;
          const corners = [[0, 0], [cw, 0], [0, capH], [cw, capH]].map(([a, b]) => [cx + ux * a + dx * b, cy + uy * a + dy * b]);
          const fits = corners.every(([X, Y]) => X >= 8 && X <= vw - 8 && Y >= 8 && Y <= vh - 4);
          return { cx, cy, ang, fits };
        };
        let spot = null;
        for (const edge of flatFirst.flatMap(outerFirst)) {
          const option = place(edge);
          spot ??= option;
          if (option.fits) {
            spot = option;
            break;
          }
        }
        this.caption.style.transform = `translate3d(${spot.cx.toFixed(1)}px, ${spot.cy.toFixed(1)}px, 0) rotate(${spot.ang.toFixed(4)}rad)`;
      }
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
