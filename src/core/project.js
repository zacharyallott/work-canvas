import gsap from 'gsap';
import { EASE } from './motion.js';
import { autoplaySrc, commandLoop, listenLoop, isPlayingMessage } from './embed.js';
import { Pull, PULL_CONFIG } from './pull.js';

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
 * The end of the page leads back to the work. The scroll stops on the last
 * image and holds there briefly (a fling ends there). Scrolling on — a fresh
 * gesture, or the same one once it has been at the end for `holdAtEnd` s —
 * pulls against resistance: the images rise a little and everything fades
 * (the info block only fades). Pull far enough and the page hands back to the
 * work; let go early and it settles back.
 *
 * The pull itself (shared with the about section) lives in pull.js.
 */

export const PROJECT_CONFIG = PULL_CONFIG; // the pull at the end of the page: see pull.js

const CSS = `
.wc-project{position:absolute;inset:0;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .35s linear,visibility 0s linear .35s}
.wc-root.is-project .wc-project{opacity:1;visibility:visible;pointer-events:auto;transition:opacity 0s,visibility 0s}
.wc-project-scroll{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:none;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:clamp(200px,26vw,285px) minmax(0,1fr);column-gap:clamp(24px,4.2vw,53px);padding:52px 15px 12px 19px;box-sizing:border-box;-webkit-user-select:text;user-select:text;outline:none}
.wc-project-info{grid-column:1;grid-row:1;align-self:start;position:sticky;top:var(--wc-info-top,60vh);display:flex;flex-direction:column;gap:7px;color:#000}
.wc-project-title{margin:0;font-size:16px;line-height:1;font-weight:500}
.wc-project-desc{margin:0;max-width:271px;font-size:16px;line-height:1.1;font-weight:400;letter-spacing:.02em;color:#5f5f5f}
.wc-project-services{display:flex;flex-wrap:wrap;column-gap:12px;row-gap:2px;margin:0;padding:0;list-style:none;font-family:var(--wc-font-mono,'Cassette Semi Mono',ui-monospace,monospace);font-size:10px;line-height:1.25;letter-spacing:.02em;text-transform:uppercase;font-weight:400}
.wc-project-desc+.wc-project-services{margin-top:41px}
.wc-project-media{grid-column:2;grid-row:1;display:flex;flex-direction:column;align-items:flex-end;gap:12px;margin:0;padding:0;list-style:none}
.wc-project-item{position:relative;width:73.5%;border-radius:4px;overflow:hidden;background:#e2e2e2}
.wc-project-item.is-loaded{background:none} /* the placeholder grey would otherwise show as a hairline at antialiased edges */
.wc-project-item:nth-child(4n+2){width:100%}
.wc-project-item:nth-child(4n+3){width:51.8%}
.wc-project-item img{display:block;width:100%;height:auto}
.wc-project-item video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
/* External video (YouTube / Vimeo): thumbnail + play button until pressed, then the player. */
.wc-project-item iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.wc-embed{appearance:none;position:absolute;inset:0;display:block;width:100%;height:100%;margin:0;padding:0;border:0;background:#111;cursor:pointer}
.wc-embed img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.wc-embed-play{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:#f2f2f2}
.wc-embed-play::after{content:"";position:absolute;left:22px;top:19px;border-style:solid;border-width:9px 0 9px 14px;border-color:transparent transparent transparent #111}
.wc-embed:focus-visible{outline:2px solid #111;outline-offset:2px}
/* #autoplay embeds: a muted loop like the MP4s. Scaled to cover the slot (--ar = the video's aspect), no pointer input,
   faded in over the thumbnail once the player has loaded. */
.wc-project-item.is-loop{container-type:size;background:#111}
.wc-project-item.is-loop img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.wc-project-item.is-loop iframe{inset:auto;left:50%;top:50%;width:max(100cqw,calc(100cqh * var(--ar,1.7778)));height:calc(max(100cqh,calc(100cqw / var(--ar,1.7778))) + 2 * var(--wc-loop-crop));translate:-50% -50%;pointer-events:none;opacity:0;transition:opacity .4s linear}
/* The player is taller than the video by a band top and bottom, so the video sits letterboxed in the middle and the
   player's own title bar / logo land in those bands, outside the slot (clipped). */
.wc-project-item.is-loop{--wc-loop-crop:calc(64px + 3cqw)}
.wc-project-item.is-loop iframe.is-on{opacity:1}
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
 * What identifies a picture. Strong: its Webflow asset ids (Webflow gives
 * identical uploads one asset, even under different names) and a content hash
 * where the page provides one. Weak: file names minus size suffixes — only
 * trusted when there's nothing strong to go on, since two different pictures
 * can share a name (e.g. two versions of Bonnell-Allott-02).
 */
const idsOf = (it) => {
  const strong = it.hash ? [`h:${it.hash}`] : [];
  if (it.embed) strong.push(`e:${it.embed.provider}:${it.embed.id}`);
  const weak = [];
  for (const url of [it.src, it.poster, it.video]) {
    if (!url) continue;
    weak.push(`n:${baseName(url)}`);
    const id = String(url).match(/\/([0-9a-f]{24})_/i);
    if (id) strong.push(`a:${id[1]}`);
  }
  return { strong, weak };
};

const samePicture = (a, b) =>
  a.strong.some((k) => b.strong.includes(k)) ||
  ((!a.strong.length || !b.strong.length) && a.weak.some((k) => b.weak.includes(k)));

/** An embedded player. */
function playerFrame(src, title) {
  const frame = document.createElement('iframe');
  frame.src = src;
  frame.title = title;
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  return frame;
}

/**
 * A YouTube/Vimeo slot: the CMS image (or YouTube's thumbnail) with a play
 * button, sized to the image (16:9 without one). No image and no thumbnail
 * (Vimeo): the player itself. With #autoplay: a muted, looping player over
 * the thumbnail, started and paused as it scrolls in and out.
 */
function embedItem(it, projectTitle) {
  const own = it.src && it.src !== it.embed.thumb; // the slot's own image, not YouTube's
  const ar = it.embed.aspect || 16 / 9; // the video's own shape
  const ratio = own && it.aspect ? it.aspect.toFixed(4) : ar.toFixed(4);
  const title = `${projectTitle} — video`;
  if (it.embed.autoplay) {
    const poster = it.src
      ? `<img src="${esc(it.src)}"${own && it.srcset ? ` srcset="${esc(it.srcset)}" sizes="(max-width:700px) 100vw, 70vw"` : ''} alt="" ${it.hero ? 'decoding="sync"' : 'loading="lazy" decoding="async"'}${own ? '' : ' data-no-fit'}>`
      : '';
    const frame = `<iframe data-src="${esc(it.embed.loopSrc)}" data-provider="${it.embed.provider}" title="${esc(title)}" tabindex="-1" allow="autoplay; encrypted-media; picture-in-picture"></iframe>`;
    return `<li class="wc-project-item is-embed is-loop${it.hero ? ' is-hero' : ''}" style="aspect-ratio:${ratio};--ar:${ar.toFixed(4)}">${poster}${frame}</li>`;
  }
  const inner = it.src
    ? `<button type="button" class="wc-embed" data-src="${esc(autoplaySrc(it.embed))}" data-title="${esc(title)}" aria-label="Play video: ${esc(projectTitle)}">` +
      `<img src="${esc(it.src)}"${own && it.srcset ? ` srcset="${esc(it.srcset)}" sizes="(max-width:700px) 100vw, 70vw"` : ''} alt="" ${it.hero ? 'decoding="sync"' : 'loading="lazy" decoding="async"'}${own ? '' : ' data-no-fit'}>` +
      `<span class="wc-embed-play" aria-hidden="true"></span></button>`
    : playerFrame(it.embed.src, title).outerHTML.replace('<iframe', '<iframe loading="lazy"');
  return `<li class="wc-project-item is-embed${it.hero ? ' is-hero' : ''}" style="aspect-ratio:${ratio}">${inner}</li>`;
}

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
    this.puller = new Pull({
      input: this.scroll,
      enabled: () => Boolean(this.scroll.firstElementChild),
      draw: (state) => this.drawPull(state),
      onEnd: () => this.onEnd?.(),
    });
    // Pressing an external video's thumbnail swaps in its player, playing.
    this.scroll.addEventListener('click', (e) => {
      const button = e.target.closest('.wc-embed');
      if (button) button.replaceWith(playerFrame(button.dataset.src, button.dataset.title));
    });
    this.io = new IntersectionObserver(
      (entries) => entries.forEach((e) => (e.isIntersecting ? e.target.play().catch(() => {}) : e.target.pause())),
      { root: this.scroll, threshold: 0.25 },
    );
    // #autoplay embeds: load the player when it's about to scroll in; play while on screen, pause when away.
    this.loopIO = new IntersectionObserver(
      (entries) =>
        entries.forEach(({ target: frame, isIntersecting }) => {
          if (isIntersecting && !frame.src) {
            // Shown once the player says it's playing (fallback: 3 s after it loads), so no black flash over the thumbnail.
            frame.addEventListener(
              'load',
              () => {
                listenLoop(frame);
                setTimeout(() => frame.classList.add('is-on'), 3000);
              },
              { once: true },
            );
            frame.src = frame.dataset.src; // autoplay=1 in the URL starts it
          } else if (frame.src) commandLoop(frame, isIntersecting);
        }),
      { root: this.scroll, rootMargin: '200px 0px', threshold: 0 },
    );
    this._onMessage = (e) => {
      if (!isPlayingMessage(e)) return;
      this.el.querySelectorAll('.is-loop iframe:not(.is-on)').forEach((f) => f.contentWindow === e.source && f.classList.add('is-on'));
    };
    window.addEventListener('message', this._onMessage);
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
      items.push({ type: hero.embed ? 'embed' : hero.type, src: heroSrc, srcset: hero.srcset, video: hero.embed ? '' : hero.sources?.at(-1)?.src, embed: hero.embed, poster: hero.poster, hash: hero.hash, aspect: hero.aspect, alt: project.title, hero: true });
    }
    // No picture twice: skip gallery entries that match the hero or an earlier entry.
    const kept = items.map(idsOf);
    for (const g of project.gallery ?? []) {
      const ids = idsOf(g);
      if (kept.some((k) => samePicture(k, ids))) continue;
      kept.push(ids);
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
            if (it.type === 'embed' && it.embed) return embedItem(it, project.title);
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
      const item = img.closest('.wc-project-item');
      const fit = () => {
        if (!img.naturalWidth) return;
        if (!img.hasAttribute('data-no-fit')) item.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        item.classList.add('is-loaded');
      };
      if (img.complete) fit();
      img.addEventListener('load', fit); // again if srcset swaps in another size
    });
    this.el.querySelectorAll('video').forEach((v) => {
      v.muted = true;
      this.io.observe(v);
    });
    this.el.querySelectorAll('.is-loop iframe').forEach((f) => this.loopIO.observe(f));
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

  // ─── Pull at the end of the page (pull.js) ─────────────────────────────────
  /** The images rise a little and fade; the info block only fades. */
  drawPull({ opacity, lift }) {
    const media = this.scroll.querySelector('.wc-project-media');
    const info = this.scroll.querySelector('.wc-project-info');
    const fade = opacity == null ? '' : String(opacity);
    if (media) {
      media.style.opacity = fade;
      media.style.translate = lift ? `0 ${lift.toFixed(2)}px` : '';
    }
    if (info) info.style.opacity = fade;
  }

  resetPull() {
    this.puller?.reset();
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
    this.el.querySelectorAll('.is-loop iframe[src]').forEach((f) => commandLoop(f, false));
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
    this.el.querySelectorAll('.is-loop iframe').forEach((f) => this.loopIO.unobserve(f)); // removing them stops the players
    this.scroll.innerHTML = '';
  }

  destroy() {
    this.clear();
    this.io.disconnect();
    this.loopIO.disconnect();
    window.removeEventListener('message', this._onMessage);
    this.el.remove();
  }
}
