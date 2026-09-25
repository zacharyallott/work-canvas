/**
 * work-canvas — entry point.
 *
 * Auto-mounts on <div id="work-canvas"> (or any [data-work-canvas]) once the
 * DOM is ready. Options come from data attributes on the mount:
 *
 *   data-layout="a|b|c"        version for a first visit; later visits rotate to the next one
 *   data-rotate="false"        always open on data-layout instead of rotating
 *                              (?v=b in the URL opens that version once; it's then dropped from the URL so a refresh rotates on)
 *   data-switcher="false"      the star doesn't cycle versions (it only returns home)
 *   data-items=".work-item"    selector for the item links
 *   data-media-base="https://…/"  base URL for relative media paths
 *   data-wheel="page|capture"  whether the header consumes vertical wheel
 *   data-max-videos="5"        concurrent video cap (overrides layouts)
 *   data-tagline="…"           top bar text (click opens the about section)
 *
 * Manual use:  import { mount } from '…/work-canvas.js'; const wc = await mount(el, { layout: 'b' }); wc.destroy();
 */
import gsap from 'gsap';
import { WorkCanvas } from './core/engine.js';
import Filmstrip, { config as filmstripConfig } from './layouts/filmstrip.js';
import Deck, { config as deckConfig } from './layouts/deck.js';
import Masonry, { config as masonryConfig } from './layouts/masonry.js';

export const LAYOUTS = [
  { key: 'a', name: 'Filmstrip', Layout: Filmstrip, config: filmstripConfig },
  { key: 'b', name: 'Deck', Layout: Deck, config: deckConfig },
  { key: 'c', name: 'Masonry', Layout: Masonry, config: masonryConfig },
];

export { WorkCanvas };

export async function mount(el, options = {}) {
  if (el.__workCanvas) return el.__workCanvas;
  const d = el.dataset;
  const params = new URLSearchParams(location.search);
  const urlLayout = params.get('v');
  if (urlLayout && !(options.syncUrl ?? d.syncUrl === 'true')) {
    // Honour ?v= for this load only, so refreshing still moves on to the next version.
    params.delete('v');
    const url = new URL(location.href);
    url.search = params.toString();
    history.replaceState(history.state, '', url);
  }
  const maxVideos = parseInt(options.maxVideos ?? d.maxVideos, 10);

  const layouts = LAYOUTS.map((l) => ({ ...l, config: { ...l.config, ...(options.config?.[l.key] ?? {}) } }));
  if (maxVideos) layouts.forEach((l) => (l.config.maxVideos = maxVideos));

  const wc = new WorkCanvas(el, {
    layouts,
    layout: options.layout ?? urlLayout ?? d.layout ?? 'a',
    rotate: options.rotate ?? (!(options.layout ?? urlLayout) && d.rotate !== 'false'),
    switcher: options.switcher ?? d.switcher !== 'false',
    syncUrl: options.syncUrl ?? d.syncUrl === 'true',
    tagline: options.tagline ?? d.tagline ?? 'design &amp; direction made to move',
    hint: options.hint ?? d.hint,
    ...options,
  });
  el.__workCanvas = wc;
  await wc.init();
  return wc;
}

function autoMount() {
  document.querySelectorAll('#work-canvas, [data-work-canvas]').forEach((el) => mount(el));
}

if (typeof window !== 'undefined') {
  window.WorkCanvas = { mount, LAYOUTS };
  if (import.meta.env?.DEV) window.WorkCanvas.gsap = gsap; // dev-only: lets tests step frames
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  else autoMount();
}
