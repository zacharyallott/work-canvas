import gsap from 'gsap';
import zaIcon from '../ui/za-icon.svg';
import dotFilled from '../ui/dot-filled.svg';
import dotEmpty from '../ui/dot-empty.svg';

/**
 * DOM layer on top of the canvas: top bar (ZA icon, tagline, version dots),
 * the floating caption, the static fallback grid, and a visually-hidden
 * wrapper for the real links. Styles are injected once and scoped to .wc-*.
 * Values from Figma: 13px inset, 12px icon, 16px tagline, 8px dots / 6px gap,
 * 12px caption, text #F2F2F2 with mix-blend-mode: difference.
 */

const CSS = `
.wc-root{position:relative;overflow:hidden;background:var(--wc-bg,#f2f2f2);min-height:var(--wc-min-height,100svh);isolation:isolate;touch-action:pan-y;-webkit-user-select:none;user-select:none}
.wc-root.is-dragging{cursor:grabbing}
.wc-root.is-hovering-tile{cursor:pointer}
.wc-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .6s ease}
.wc-root.is-ready .wc-canvas{opacity:1}
/* no z-index here: a stacking context would stop mix-blend-mode reaching the canvas */
.wc-ui{position:absolute;inset:0;pointer-events:none;font-family:var(--wc-font,inherit);font-weight:var(--wc-font-weight,500);color:#f2f2f2}
.wc-topbar{position:absolute;left:13px;right:13px;top:13px;display:flex;align-items:center;justify-content:space-between;mix-blend-mode:difference}
.wc-icon{display:block;width:12px;height:12px}
.wc-icon img{display:block;width:12px;height:12px}
.wc-tagline{display:flex;gap:8px;align-items:center;font-size:16px;line-height:1;color:#f2f2f2;text-decoration:none;pointer-events:auto;white-space:nowrap}
.wc-tagline .wc-arrow{display:inline-block;transform:rotate(90deg);width:17px;text-align:center}
.wc-dots{display:flex;gap:6px;align-items:center;pointer-events:auto}
.wc-dot{appearance:none;border:0;padding:4px;margin:-4px;background:none;cursor:pointer;display:block;line-height:0}
.wc-dot img{display:block;width:8px;height:8px}
.wc-dot:focus-visible{outline:1px solid #f2f2f2;outline-offset:2px;border-radius:50%}
.wc-caption{position:absolute;left:0;top:0;font-size:12px;line-height:1.15;white-space:pre;mix-blend-mode:difference;overflow:hidden;visibility:hidden;will-change:transform}
.wc-caption-inner{display:block;transform:translateY(110%)}
.wc-hint{position:absolute;left:50%;bottom:13px;transform:translateX(-50%);font-size:11px;line-height:1;mix-blend-mode:difference;opacity:.6;white-space:nowrap}
.wc-fallback{position:absolute;inset:0;columns:160px;column-gap:18px;padding:48px 13px 13px;overflow:auto;transition:opacity .6s ease;cursor:auto}
.wc-fallback a,.wc-fallback div{display:block;break-inside:avoid;margin:0 0 18px;border-radius:8px;overflow:hidden;background:#e2e2e2}
.wc-fallback img{display:block;width:100%;height:100%;object-fit:cover}
.wc-root.is-ready .wc-fallback{opacity:0;pointer-events:none}
.wc-sr{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;display:block!important}
@media (max-width:600px){.wc-tagline{font-size:13px}}
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
  constructor(mount, { layouts, current, onSelect, tagline, taglineHref, showDots = true, hint }) {
    injectStyles();
    this.mount = mount;
    this.onSelect = onSelect;

    this.root = document.createElement('div');
    this.root.className = 'wc-ui';
    this.root.innerHTML = `
      <div class="wc-topbar">
        <span class="wc-icon"><img src="${zaIcon}" alt="" width="12" height="12"></span>
        <a class="wc-tagline" href="${taglineHref}">${tagline}<span class="wc-arrow" aria-hidden="true">→</span></a>
        <div class="wc-dots" role="tablist" aria-label="Header version"></div>
      </div>
      <div class="wc-caption" aria-hidden="true"><span class="wc-caption-inner"></span></div>
      ${hint ? `<div class="wc-hint" aria-hidden="true">${hint}</div>` : ''}
    `;
    this.caption = this.root.querySelector('.wc-caption');
    this.captionInner = this.root.querySelector('.wc-caption-inner');
    this.dots = this.root.querySelector('.wc-dots');

    if (showDots) {
      this.dotButtons = layouts.map(({ key, name }, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wc-dot';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-label', `Version ${key.toUpperCase()}: ${name}`);
        b.innerHTML = `<img src="${dotEmpty}" alt="" width="8" height="8">`;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onSelect(key);
        });
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.dots.appendChild(b);
        return { key, b };
      });
      this.setActive(current);
    }
    mount.appendChild(this.root);

    this.captionState = { target: null, shown: null };
  }

  setActive(key) {
    this.dotButtons?.forEach(({ key: k, b }) => {
      const on = k === key;
      b.setAttribute('aria-selected', String(on));
      b.querySelector('img').src = on ? dotFilled : dotEmpty;
    });
  }

  /** Static grid shown before WebGL is ready, and permanently if it's unavailable. */
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
   * Caption for the hovered tile: "Title  ↓", bottom-left inside the tile,
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
        tl.to(inner, reducedMotion ? { opacity: 0, duration: 0.15 } : { yPercent: -110, duration: 0.18, ease: 'power2.in' });
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
          { yPercent: 0, opacity: 1, duration: reducedMotion ? 0.2 : 0.5, ease: 'power3.out' },
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
    this.root.remove();
    this.fallback?.remove();
  }
}

/** Visually hides the real link lists (CMS output) without removing them from the a11y tree. */
export function hideLinkLists(items) {
  // Prefer hiding the whole list (put data-work-list on the Collection List Wrapper);
  // otherwise hide each link individually.
  for (const { el } of items) {
    const list = el.closest('[data-work-list]');
    (list ?? el).classList.add('wc-sr');
  }
}
